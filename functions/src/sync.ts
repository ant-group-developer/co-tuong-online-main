/**
 * Side effect SAU commit (không bao giờ chạy trong callback transaction):
 *  - publicRooms: chỉ mục dẫn xuất cho lobby (không phải nguồn phân quyền).
 *  - deadlines: chỉ mục dẫn xuất cho sweep hết giờ dự phòng.
 *  - Cloud Task hẹn giờ cho deadline của lượt hiện tại.
 *  - pendingResults + trạng thái phòng khi trận kết thúc.
 */
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions/v2';
import { REGION, TIME_CONTROLS } from './config.js';
import { HttpsError } from 'firebase-functions/v2/https';
import { ACTIVE_ROOM_STATUSES, onMatchFinished, userRoomChanges, type RoomDoc } from './core/room-core.js';
import type { MatchDoc } from './core/types.js';
import { rtdb, runTx } from './firebase.js';

const LISTED: string[] = ['waiting', 'ready', 'playing'];

export interface UserRoomEntry {
  roomId: string;
  mode: string;
  at: number;
}

/**
 * Chỉ mục dẫn xuất userRooms/{uid}: phòng mà người chơi đang ngồi ghế (waiting/ready/playing).
 * Client dùng để đưa người chơi quay lại phòng; server dùng để chặn vào/tạo phòng thứ hai.
 */
export async function syncUserRooms(prev: RoomDoc | null, next: RoomDoc | null): Promise<void> {
  const room = next ?? prev;
  if (!room) return;
  const roomId = room.meta.roomId;
  const { set, clear } = userRoomChanges(prev, next);
  const now = Date.now();
  const updates: Record<string, UserRoomEntry | null> = {};
  for (const uid of set) updates[`userRooms/${uid}`] = { roomId, mode: room.meta.mode, at: now };
  for (const uid of clear) {
    // Chỉ xóa nếu chỉ mục vẫn trỏ về phòng này (không xóa nhầm phòng mới của người đó).
    const cur = (await rtdb().ref(`userRooms/${uid}`).get()).val() as UserRoomEntry | null;
    if (cur?.roomId === roomId) updates[`userRooms/${uid}`] = null;
  }
  if (Object.keys(updates).length) await rtdb().ref().update(updates);
}

/**
 * Chặn người đang ngồi ở một phòng còn hoạt động vào/tạo phòng khác.
 * Chỉ mục cũ (phòng đã xóa/kết thúc, hoặc người đó không còn ngồi ghế) được dọn và bỏ qua.
 */
export async function assertNotInOtherRoom(uid: string, opts: { exceptRoomId?: string; onlyMode?: string } = {}): Promise<void> {
  const ref = rtdb().ref(`userRooms/${uid}`);
  const cur = (await ref.get()).val() as UserRoomEntry | null;
  if (!cur || cur.roomId === opts.exceptRoomId) return;
  const room = (await rtdb().ref(`rooms/${cur.roomId}`).get()).val() as RoomDoc | null;
  const seated = !!room && (room.seats?.host?.uid === uid || room.seats?.guest?.uid === uid);
  if (!room || !seated || !ACTIVE_ROOM_STATUSES.includes(room.meta.status)) {
    await ref.remove();
    return;
  }
  if (opts.onlyMode && room.meta.mode !== opts.onlyMode) return;
  throw new HttpsError('failed-precondition', `Bạn đang ở phòng ${cur.roomId}. Hãy quay lại hoặc rời phòng đó trước.`, {
    code: 'already_in_room',
    key: 'already_in_room',
    roomId: cur.roomId,
  });
}

export async function syncPublicIndex(room: RoomDoc): Promise<void> {
  const id = room.meta.roomId;
  const ref = rtdb().ref(`publicRooms/${id}`);
  if (room.meta.visibility !== 'public' || !LISTED.includes(room.meta.status)) {
    await ref.remove();
    return;
  }
  const match = room.meta.matchId ? room.matches?.[room.meta.matchId] : undefined;
  // Chỉ dữ liệu an toàn: không có members, không có token, không có email.
  await ref.update({
    roomId: id,
    mode: room.meta.mode,
    status: room.meta.status,
    tc: room.meta.tc,
    tcLabel: TIME_CONTROLS[room.meta.tc]?.label ?? room.meta.tc,
    ownerName: room.meta.ownerName,
    hostName: room.seats?.host?.name ?? null,
    guestName: room.seats?.guest?.name ?? null,
    seatsFree: room.seats?.guest ? 0 : 1,
    redName: match?.players.red.name ?? null,
    blackName: match?.players.black.name ?? null,
    createdAt: room.meta.createdAt,
    updatedAt: room.meta.updatedAt,
  });
}

export async function scheduleDeadline(roomId: string, m: MatchDoc): Promise<void> {
  const s = m.state;
  const idxRef = rtdb().ref(`deadlines/${m.matchId}`);
  if (s.status !== 'playing' || !s.deadline) {
    await idxRef.remove();
    return;
  }
  await idxRef.set({ roomId, at: s.deadline, v: s.v });
  if (process.env.FUNCTIONS_EMULATOR === 'true') return; // emulator: Cloud Tasks không hỗ trợ scheduleTime
  try {
    const queue = getFunctions().taskQueue(`locations/${REGION}/functions/clockTimeout`);
    await queue.enqueue(
      { roomId, matchId: m.matchId, v: s.v, deadline: s.deadline },
      { scheduleTime: new Date(s.deadline + 200), id: `${m.matchId}-v${s.v}` },
    );
  } catch (e) {
    // Không chặn nước đi nếu hẹn giờ lỗi: sweep định kỳ + claimTimeout của client vẫn bảo đảm kết thúc.
    const msg = String((e as Error)?.message ?? e);
    if (!/already exists|ALREADY_EXISTS|task-already-exists/i.test(msg)) logger.warn('enqueue clockTimeout failed', { matchId: m.matchId, msg });
  }
}

export async function afterMatchStarted(room: RoomDoc, matchId: string): Promise<void> {
  const m = room.matches?.[matchId];
  if (m) await scheduleDeadline(room.meta.roomId, m);
}

/** Gọi sau khi một transaction trên trận đã commit. */
export async function afterMatchCommitted(roomId: string, m: MatchDoc, finished: boolean): Promise<void> {
  await scheduleDeadline(roomId, m);
  if (!finished) return;
  await rtdb().ref(`pendingResults/${m.matchId}`).set({ roomId, at: m.state.result?.endedAt ?? Date.now() });
  const aborted = m.state.status === 'aborted';
  let prev: RoomDoc | null = null;
  const { result } = await runTx<RoomDoc, ReturnType<typeof onMatchFinished> & { value?: RoomDoc | null }>(
    rtdb().ref(`rooms/${roomId}`),
    (cur) => {
      prev = cur;
      const r = onMatchFinished(cur, m.matchId, aborted, Date.now());
      return { ...r, value: r.room };
    },
  );
  if (result.room) {
    await syncPublicIndex(result.room);
    if (result.commit) await syncUserRooms(prev, result.room);
  }
}
