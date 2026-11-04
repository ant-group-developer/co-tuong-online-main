/**
 * Xử lý kết quả trận (outbox RTDB -> Firestore), ĐÚNG MỘT LẦN theo matchId.
 *
 *  1. Kết quả bất biến + outbox được ghi trong CÙNG transaction RTDB của trận (match-core.finalize).
 *  2. Trigger onValueCreated(outbox) [retry: true] + sweep reconcile định kỳ gọi processResult.
 *  3. processResult: Firestore transaction đọc ratingLedger/{matchId}; nếu đã có => bỏ qua (idempotent).
 *     Ngược lại cập nhật playerStats hai người + leaderboard + archive + history + ledger trong một transaction.
 *  4. Sau khi Firestore commit: đánh dấu outbox done, gỡ lease mm/active & mm/assign.
 *     Nếu bước 4 lỗi, lần chạy lại thấy ledger đã có -> chỉ làm lại bước 4.
 *  KHÔNG có transaction xuyên RTDB + Firestore; tính đúng-một-lần dựa vào ledger.
 *  Thứ tự rating theo người chơi: lease mm/active ngăn bắt đầu trận rated mới trước khi trận trước được ghi xong.
 */
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { onValueCreated } from 'firebase-functions/v2/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { DB_TRIGGER_REGION, RATING_CONFIG, REGION } from './config.js';
import { applyOutcome, defaultStats, eloUpdate, winRate, type Outcome, type PlayerStats } from './core/rating.js';
import type { MatchDoc } from './core/types.js';
import type { MmState } from './core/matchmaking-core.js';
import { fs, rtdb } from './firebase.js';

function outcomeFor(m: MatchDoc, side: 'red' | 'black'): Outcome {
  const w = m.state.result!.winner;
  if (w === 'draw') return 'draw';
  return w === side ? 'win' : 'loss';
}

export async function processResult(roomId: string, matchId: string): Promise<'done' | 'skipped' | 'missing'> {
  const ref = rtdb().ref(`rooms/${roomId}/matches/${matchId}`);
  const m = (await ref.get()).val() as MatchDoc | null;
  if (!m || !m.state?.result) return 'missing';
  if (m.outbox?.status === 'done') {
    await cleanupLeases(m);
    return 'skipped';
  }
  const aborted = m.state.status === 'aborted';
  const rated = m.rated && !aborted;
  const db = fs();
  const moves = m.state.moves ? m.state.moves.split(' ') : [];

  await db.runTransaction(async (tx) => {
    const ledgerRef = db.doc(`ratingLedger/${matchId}`);
    const ledger = await tx.get(ledgerRef);
    if (ledger.exists) return; // đã áp dụng – idempotent

    const sides = ['red', 'black'] as const;
    const statRefs = sides.map((s) => db.doc(`playerStats/${m.players[s].uid}`)) as [DocumentReference, DocumentReference];
    const profRefs = sides.map((s) => db.doc(`publicProfiles/${m.players[s].uid}`));
    const snaps = await tx.getAll(...statRefs, ...profRefs);
    const stats = [0, 1].map((i) => ({ ...defaultStats(), ...((snaps[i].data() as Partial<PlayerStats>) ?? {}) })) as [PlayerStats, PlayerStats];
    const profiles = [2, 3].map((i) => snaps[i].data() ?? {});

    const before = [stats[0].rating, stats[1].rating];
    let after: [number | null, number | null] = [null, null];
    if (rated) {
      const scoreRed = m.state.result!.winner === 'red' ? 1 : m.state.result!.winner === 'draw' ? 0.5 : 0;
      const e = eloUpdate(stats[0], stats[1], scoreRed);
      after = [e.a, e.b];
    }

    const newStats: PlayerStats[] = [];
    if (!aborted) {
      sides.forEach((s, i) => newStats.push(applyOutcome(stats[i], outcomeFor(m, s), rated, after[i], matchId)));
      sides.forEach((s, i) => {
        tx.set(statRefs[i], { ...newStats[i], updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        const lbRef = db.doc(`leaderboard/${m.players[s].uid}`);
        if (rated && newStats[i].ratedGames >= RATING_CONFIG.placementGames) {
          tx.set(lbRef, {
            uid: m.players[s].uid,
            displayName: String(profiles[i].displayName ?? m.players[s].name).slice(0, 24),
            photoURL: typeof profiles[i].photoURL === 'string' ? profiles[i].photoURL : null,
            rating: newStats[i].rating,
            ratedGames: newStats[i].ratedGames,
            wins: newStats[i].wins,
            losses: newStats[i].losses,
            draws: newStats[i].draws,
            winRate: winRate(newStats[i]),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });
    }

    const endedAt = m.state.result!.endedAt;
    const playerDoc = (s: 'red' | 'black', i: number) => ({
      uid: m.players[s].uid,
      name: m.players[s].name,
      ratingBefore: rated ? before[i] : null,
      ratingAfter: rated ? after[i] : null,
    });
    tx.set(db.doc(`matches/${matchId}`), {
      matchId,
      roomId,
      mode: m.mode,
      rated,
      visibility: m.visibility,
      status: m.state.status,
      red: playerDoc('red', 0),
      black: playerDoc('black', 1),
      playerUids: [m.players.red.uid, m.players.black.uid],
      winner: m.state.result!.winner,
      reason: m.state.result!.reason,
      startFen: m.state.startFen,
      moves,
      plies: moves.length,
      finalFen: m.state.fen,
      finalHash: m.state.hash,
      finalVersion: m.state.v,
      rulesVersion: m.rulesVersion,
      startedAt: m.createdAt,
      endedAt,
    });
    sides.forEach((s, i) => {
      const opp = s === 'red' ? 'black' : 'red';
      tx.set(db.doc(`players/${m.players[s].uid}/history/${matchId}`), {
        matchId,
        color: s,
        opponent: { uid: m.players[opp].uid, name: m.players[opp].name },
        result: aborted ? 'aborted' : outcomeFor(m, s),
        reason: m.state.result!.reason,
        mode: m.mode,
        rated,
        visibility: m.visibility,
        ratingBefore: rated ? before[i] : null,
        ratingAfter: rated ? after[i] : null,
        plies: moves.length,
        endedAt,
      });
    });
    tx.set(ledgerRef, {
      matchId,
      roomId,
      rated,
      aborted,
      ratingConfig: RATING_CONFIG.version,
      deltas: rated ? { red: (after[0] ?? before[0]) - before[0], black: (after[1] ?? before[1]) - before[1] } : null,
      appliedAt: FieldValue.serverTimestamp(),
    });
  });

  await ref.child('outbox').update({ status: 'done', processedAt: Date.now() });
  await rtdb().ref(`pendingResults/${matchId}`).remove();
  await cleanupLeases(m);
  return 'done';
}

/** Gỡ lease xếp hạng sau khi kết quả đã ghi xong. */
async function cleanupLeases(m: MatchDoc): Promise<void> {
  if (m.mode !== 'ranked') return;
  const uids = [m.players.red.uid, m.players.black.uid];
  await rtdb()
    .ref('mm')
    .transaction((cur: MmState | null) => {
      if (!cur) return cur;
      for (const uid of uids) {
        if (cur.active?.[uid] === m.matchId) delete cur.active[uid];
        if (cur.assign?.[uid]?.matchId === m.matchId) delete cur.assign[uid];
      }
      return cur;
    });
}

export const onMatchOutbox = onValueCreated(
  { ref: '/rooms/{roomId}/matches/{matchId}/outbox', region: DB_TRIGGER_REGION, retry: true },
  async (event) => {
    const { roomId, matchId } = event.params;
    const r = await processResult(roomId, matchId);
    logger.info('processResult', { roomId, matchId, r });
  },
);

/** Đối soát: xử lý lại các kết quả còn pending (trigger thất bại hết số lần retry, mất sự kiện...). */
export const reconcileResults = onSchedule({ region: REGION, schedule: 'every 5 minutes', timeZone: 'Asia/Ho_Chi_Minh' }, async () => {
  const cutoff = Date.now() - 60_000;
  const snap = await rtdb().ref('pendingResults').orderByChild('at').endAt(cutoff).limitToFirst(100).get();
  const jobs: Promise<unknown>[] = [];
  snap.forEach((c) => {
    const { roomId } = c.val() as { roomId: string };
    jobs.push(
      processResult(roomId, c.key!).catch((e) => logger.error('reconcile failed', { matchId: c.key, e: String(e) })),
    );
  });
  await Promise.all(jobs);
});
