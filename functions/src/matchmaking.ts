/**
 * Đấu xếp hạng: server ghép đối thủ theo rating + time control. Link bạn bè KHÔNG dùng được cho ranked.
 * Client gọi mmEnqueue định kỳ (~4s) khi đang chờ: vừa làm "heartbeat", vừa mở rộng khoảng rating theo thời gian.
 */
import { onCall } from 'firebase-functions/v2/https';
import { RANKED_TIME_CONTROLS, RATING_CONFIG, REGION } from './config.js';
import { mmCancel, mmEnqueue, type Assignment, type MmState } from './core/matchmaking-core.js';
import { newRankedRoom, type RoomDoc } from './core/room-core.js';
import { ENFORCE_APP_CHECK, httpsError, displayNameOf, fs, randomId, requireAuth, rtdb } from './firebase.js';
import { afterMatchStarted, assertNotInOtherRoom, syncPublicIndex, syncUserRooms } from './sync.js';

// invoker 'public': Cloud Run cho phép gọi; xác thực Firebase Auth vẫn do requireAuth kiểm tra.
const callOpts = { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, cors: true, invoker: 'public' } as const;

async function currentRating(uid: string): Promise<number> {
  const snap = await fs().doc(`playerStats/${uid}`).get();
  const r = snap.exists ? Number(snap.get('rating')) : NaN;
  return Number.isFinite(r) ? r : RATING_CONFIG.initial;
}

/** Tạo phòng xếp hạng cho cặp đã ghép – idempotent (tạo nếu chưa có). */
async function ensureRankedRoom(pair: {
  roomId: string;
  matchId: string;
  a: { uid: string; name: string; rating: number };
  b: { uid: string; name: string; rating: number };
  tc: string;
}): Promise<void> {
  const ref = rtdb().ref(`rooms/${pair.roomId}`);
  let created: RoomDoc | null = null;
  await ref.transaction((cur: RoomDoc | null) => {
    if (cur !== null) {
      created = null;
      return; // đã tồn tại
    }
    // Màu ngẫu nhiên theo matchId (không do client chọn)
    const swap = pair.matchId.charCodeAt(0) % 2 === 1;
    const room = newRankedRoom({ ...pair, a: swap ? pair.b : pair.a, b: swap ? pair.a : pair.b, now: Date.now() });
    created = room;
    return room;
  });
  if (created) {
    const room = created as RoomDoc;
    await syncPublicIndex(room);
    await syncUserRooms(null, room);
    await afterMatchStarted(room, pair.matchId);
  }
}

export const mmEnqueueFn = onCall(callOpts, async (req) => {
  // Khách (anonymous) cũng được đấu xếp hạng: mỗi trình duyệt có một ID khách cố định.
  const user = requireAuth(req);
  const tc = (req.data as { tc?: unknown })?.tc;
  if (typeof tc !== 'string' || !RANKED_TIME_CONTROLS.includes(tc)) throw httpsError('invalid-argument', 'Thời gian không hợp lệ cho đấu xếp hạng');
  // Đang ngồi ở phòng chơi với bạn thì không cho vào hàng chờ (phòng xếp hạng do chính matchmaking xử lý).
  await assertNotInOtherRoom(user.uid, { onlyMode: 'friendly' });
  const [rating, name] = await Promise.all([currentRating(user.uid), displayNameOf(user)]);
  let outcome: ReturnType<typeof mmEnqueue> | null = null;
  await rtdb()
    .ref('mm')
    .transaction((cur: MmState | null) => {
      const now = Date.now();
      // ID sinh mới mỗi lần chạy lại; chỉ lần chạy commit cuối cùng được dùng.
      outcome = mmEnqueue(cur, { uid: user.uid, name, rating, tc }, now, () => ({ roomId: randomId(10), matchId: randomId(20) }));
      if (outcome.status === 'matched' && !outcome.newPair) return; // không đổi gì
      if (outcome.status === 'busy') return;
      return outcome.state;
    });
  const o = outcome as ReturnType<typeof mmEnqueue> | null;
  if (!o) throw httpsError('internal', 'Lỗi hàng chờ');
  if (o.newPair) {
    const { a, b, roomId, matchId } = o.newPair;
    await ensureRankedRoom({ roomId, matchId, a, b, tc });
  } else if (o.status === 'matched' && o.assignment) {
    const roomStatus = (await rtdb().ref(`rooms/${o.assignment.roomId}/meta/status`).get()).val() as string | null;
    if (roomStatus === 'finished' || roomStatus === 'cancelled') {
      // Trận rated trước đã xong nhưng kết quả chưa ghi xong vào Firestore: chưa cho vào hàng chờ
      // để không ghép bằng rating cũ. Client thử lại sau vài giây.
      return { status: 'settling', roomId: null, matchId: o.assignment.matchId, rating };
    }
    // Phục hồi: đã ghép nhưng phòng chưa được tạo (ví dụ Function trước bị dừng giữa chừng).
    if (roomStatus === null) {
      const opp = o.assignment.opponentUid;
      const oppName = ((await fs().doc(`publicProfiles/${opp}`).get()).get('displayName') as string) || 'Đối thủ';
      await ensureRankedRoom({
        roomId: o.assignment.roomId,
        matchId: o.assignment.matchId,
        a: { uid: user.uid, name, rating },
        b: { uid: opp, name: oppName, rating: await currentRating(opp) },
        tc,
      });
    }
  }
  return {
    status: o.status,
    roomId: o.assignment?.roomId ?? null,
    matchId: o.assignment?.matchId ?? o.activeMatchId ?? null,
    rating,
  };
});

export const mmCancelFn = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  let status: 'cancelled' | 'matched' | 'not_queued' = 'not_queued';
  let assignment: Assignment | undefined;
  await rtdb()
    .ref('mm')
    .transaction((cur: MmState | null) => {
      // Admin SDK có thể gọi lần đầu với null (cache rỗng): trả null để SDK đọc giá trị thật rồi chạy lại.
      // KHÔNG abort ở lần này, nếu không sẽ báo 'not_queued' sai khi người chơi đã được ghép.
      if (cur === null) return null;
      const r = mmCancel(cur, user.uid);
      status = r.status;
      assignment = r.assignment;
      if (r.status !== 'cancelled') return;
      return r.state;
    });
  // Race cancel vs matched: nếu đã ghép xong thì không hủy được, trả về phòng để client vào trận.
  return { status, roomId: (assignment as Assignment | undefined)?.roomId ?? null };
});
