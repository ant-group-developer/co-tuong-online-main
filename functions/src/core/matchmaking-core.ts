/**
 * Lõi ghép trận xếp hạng – hàm thuần, chạy trong transaction trên node `mm` của RTDB.
 *   mm/queue/{uid}   : mục chờ
 *   mm/assign/{uid}  : kết quả ghép (roomId/matchId) – client theo dõi
 *   mm/active/{uid}  : "lease" trận rated đang diễn ra/chờ tính điểm. Còn lease => không được vào hàng chờ.
 * Lease chỉ được gỡ SAU KHI rating của trận đó đã ghi vào Firestore => không bao giờ ghép từ rating cũ,
 * và một UID không thể có hai trận rated song song.
 */
import { MATCHMAKING } from '../config.js';

export interface QueueEntry {
  uid: string;
  name: string;
  rating: number;
  tc: string;
  enqueuedAt: number;
  lastSeenAt: number;
}

export interface Assignment {
  roomId: string;
  matchId: string;
  opponentUid: string;
  at: number;
}

export interface MmState {
  queue?: Record<string, QueueEntry>;
  assign?: Record<string, Assignment>;
  active?: Record<string, string>;
}

export type EnqueueStatus = 'queued' | 'matched' | 'busy';

export interface EnqueueOutcome {
  state: MmState;
  status: EnqueueStatus;
  assignment?: Assignment;
  /** Ghép mới trong lần này (cần tạo phòng). */
  newPair?: { a: QueueEntry; b: QueueEntry; roomId: string; matchId: string };
  activeMatchId?: string;
}

export function ratingWindow(waitMs: number): number {
  return Math.min(MATCHMAKING.maxWindow, MATCHMAKING.baseWindow + MATCHMAKING.windowStepPer5s * Math.floor(waitMs / 5000));
}

export function mmEnqueue(
  current: MmState | null,
  me: { uid: string; name: string; rating: number; tc: string },
  now: number,
  newIds: () => { roomId: string; matchId: string },
): EnqueueOutcome {
  const st: MmState = JSON.parse(JSON.stringify(current ?? {}));
  st.queue = st.queue ?? {};
  st.assign = st.assign ?? {};
  st.active = st.active ?? {};

  const existing = st.assign[me.uid];
  if (existing) return { state: st, status: 'matched', assignment: existing };
  if (st.active[me.uid]) return { state: st, status: 'busy', activeMatchId: st.active[me.uid] };

  // Dọn mục chờ cũ (client không poll nữa)
  for (const [uid, e] of Object.entries(st.queue)) {
    if (now - e.lastSeenAt > MATCHMAKING.staleMs) delete st.queue[uid];
  }

  const prev = st.queue[me.uid];
  const mine: QueueEntry = {
    uid: me.uid,
    name: me.name,
    rating: me.rating,
    tc: me.tc,
    // Đổi time control => tính lại thời gian chờ
    enqueuedAt: prev && prev.tc === me.tc ? prev.enqueuedAt : now,
    lastSeenAt: now,
  };
  st.queue[me.uid] = mine;

  const myWindow = ratingWindow(now - mine.enqueuedAt);
  let best: QueueEntry | null = null;
  for (const e of Object.values(st.queue)) {
    if (e.uid === me.uid || e.tc !== me.tc) continue; // chống tự ghép
    if (st.active[e.uid] || st.assign[e.uid]) continue;
    const diff = Math.abs(e.rating - mine.rating);
    const window = Math.min(myWindow, ratingWindow(now - e.enqueuedAt));
    if (diff > window) continue;
    if (
      !best ||
      diff < Math.abs(best.rating - mine.rating) ||
      (diff === Math.abs(best.rating - mine.rating) && e.enqueuedAt < best.enqueuedAt)
    ) {
      best = e;
    }
  }
  if (!best) return { state: st, status: 'queued' };

  const ids = newIds();
  delete st.queue[me.uid];
  delete st.queue[best.uid];
  const a: Assignment = { roomId: ids.roomId, matchId: ids.matchId, opponentUid: best.uid, at: now };
  const b: Assignment = { roomId: ids.roomId, matchId: ids.matchId, opponentUid: me.uid, at: now };
  st.assign[me.uid] = a;
  st.assign[best.uid] = b;
  st.active[me.uid] = ids.matchId;
  st.active[best.uid] = ids.matchId;
  return { state: st, status: 'matched', assignment: a, newPair: { a: mine, b: best, ...ids } };
}

export type CancelStatus = 'cancelled' | 'matched' | 'not_queued';

export function mmCancel(current: MmState | null, uid: string): { state: MmState; status: CancelStatus; assignment?: Assignment } {
  const st: MmState = JSON.parse(JSON.stringify(current ?? {}));
  if (st.assign?.[uid]) return { state: st, status: 'matched', assignment: st.assign[uid] };
  if (st.queue?.[uid]) {
    delete st.queue[uid];
    return { state: st, status: 'cancelled' };
  }
  return { state: st, status: 'not_queued' };
}
