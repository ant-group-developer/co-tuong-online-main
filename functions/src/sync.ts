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
import { onMatchFinished, type RoomDoc } from './core/room-core.js';
import type { MatchDoc } from './core/types.js';
import { rtdb, runTx } from './firebase.js';

const LISTED: string[] = ['waiting', 'ready', 'playing'];

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
  const { result } = await runTx<RoomDoc, ReturnType<typeof onMatchFinished> & { value?: RoomDoc | null }>(
    rtdb().ref(`rooms/${roomId}`),
    (cur) => {
      const r = onMatchFinished(cur, m.matchId, aborted, Date.now());
      return { ...r, value: r.room };
    },
  );
  if (result.room) await syncPublicIndex(result.room);
}
