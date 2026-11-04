/**
 * Lá»‡nh trong tráº­n (server cÃ³ tháº©m quyá»n). Client chá»‰ gá»­i intent; UID láº¥y tá»« auth context.
 * Há»£p Ä‘á»“ng submitMove: { roomId, matchId, commandId, expectedVersion, from, to }.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { getFunctions } from 'firebase-admin/functions';
import { REGION } from './config.js';
import { applyCommand, applyTimeoutCheck, validateCommand } from './core/match-core.js';
import type { CommandOutcome, MatchCommand, MatchDoc } from './core/types.js';
import { ENFORCE_APP_CHECK, httpsErrorFor, requireAuth, rtdb, runTx } from './firebase.js';
import { afterMatchCommitted } from './sync.js';

// invoker 'public': Cloud Run cho phép gọi; xác thực Firebase Auth vẫn do requireAuth/requireIdentified kiểm tra.
const callOpts = { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, cors: true, invoker: 'public' } as const;
const ID_RE = /^[a-z0-9]{6,24}$/;

async function opponentOfflineSince(roomId: string, m: MatchDoc, uid: string): Promise<number | null> {
  const opp = m.players.red.uid === uid ? m.players.black.uid : m.players.red.uid;
  const online = await rtdb().ref(`roomViewers/${roomId}/${opp}`).get();
  if (online.exists()) return null;
  const seen = (await rtdb().ref(`roomLastSeen/${roomId}/${opp}`).get()).val();
  return typeof seen === 'number' ? seen : m.createdAt;
}

export async function runCommand(uid: string, roomId: string, matchId: string, cmd: MatchCommand) {
  const ref = rtdb().ref(`rooms/${roomId}/matches/${matchId}`);
  let offlineSince: number | null = null;
  if (cmd.type === 'claimAbandon') {
    const m = (await ref.get()).val() as MatchDoc | null;
    if (!m) throw httpsErrorFor('not_found', 'Tráº­n khÃ´ng tá»“n táº¡i');
    offlineSince = await opponentOfflineSince(roomId, m, uid);
  }
  const { result, committed } = await runTx<MatchDoc, CommandOutcome & { value?: MatchDoc | null }>(ref, (cur) => {
    if (!cur) return { commit: false, match: cur as unknown as MatchDoc, ok: false, code: 'not_found', finished: false };
    // `now` láº¥y trong callback: láº§n cháº¡y láº¡i dÃ¹ng thá»i Ä‘iá»ƒm má»›i nháº¥t (server lÃ  nguá»“n thá»i gian duy nháº¥t).
    const r = applyCommand(cur, cmd, { uid, now: Date.now(), opponentOfflineSince: offlineSince });
    return { ...r, value: r.match };
  });
  if (result.code === 'not_found') throw httpsErrorFor('not_found', 'Tráº­n khÃ´ng tá»“n táº¡i');
  if (result.code === 'not_player' || result.code === 'bad_request') throw httpsErrorFor(result.code, result.message);
  if (result.commit && committed) await afterMatchCommitted(roomId, result.match, result.finished);
  return {
    ok: result.ok,
    code: result.code,
    message: result.message ?? null,
    version: result.match?.state?.v ?? null,
    status: result.match?.state?.status ?? null,
  };
}

function parseIds(data: unknown): { roomId: string; matchId: string } {
  const d = (data ?? {}) as { roomId?: unknown; matchId?: unknown };
  if (typeof d.roomId !== 'string' || !ID_RE.test(d.roomId)) throw new HttpsError('invalid-argument', 'roomId khÃ´ng há»£p lá»‡');
  if (typeof d.matchId !== 'string' || !ID_RE.test(d.matchId)) throw new HttpsError('invalid-argument', 'matchId khÃ´ng há»£p lá»‡');
  return { roomId: d.roomId, matchId: d.matchId };
}

export const submitMove = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const { roomId, matchId } = parseIds(req.data);
  const cmd = validateCommand({ ...(req.data as object), type: 'move' });
  if (!cmd) throw new HttpsError('invalid-argument', 'Lá»‡nh Ä‘i quÃ¢n khÃ´ng há»£p lá»‡');
  return runCommand(user.uid, roomId, matchId, cmd);
});

export const matchAction = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const { roomId, matchId } = parseIds(req.data);
  const cmd = validateCommand(req.data);
  if (!cmd || cmd.type === 'move') throw new HttpsError('invalid-argument', 'Lá»‡nh khÃ´ng há»£p lá»‡');
  return runCommand(user.uid, roomId, matchId, cmd);
});

/** Kiá»ƒm tra háº¿t giá» phÃ­a server (dÃ¹ng cho task/sweep). Bá» qua náº¿u version Ä‘Ã£ Ä‘á»•i (task cÅ©). */
export async function checkTimeout(roomId: string, matchId: string, expectedVersion?: number): Promise<string> {
  const ref = rtdb().ref(`rooms/${roomId}/matches/${matchId}`);
  const { result, committed } = await runTx<MatchDoc, CommandOutcome & { value?: MatchDoc | null }>(ref, (cur) => {
    if (!cur) return { commit: false, match: cur as unknown as MatchDoc, ok: false, code: 'not_found', finished: false };
    const r = applyTimeoutCheck(cur, Date.now(), expectedVersion);
    return { ...r, value: r.match };
  });
  if (result.commit && committed) await afterMatchCommitted(roomId, result.match, true);
  return result.code;
}

export const clockTimeout = onTaskDispatched<{ roomId: string; matchId: string; v: number; deadline: number }>(
  {
    region: REGION,
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 2 },
    rateLimits: { maxConcurrentDispatches: 50 },
  },
  async (req) => {
    const { roomId, matchId, v, deadline } = req.data;
    if (!ID_RE.test(roomId) || !ID_RE.test(matchId)) return;
    const code = await checkTimeout(roomId, matchId, v);
    if (code === 'not_expired' && Date.now() < deadline) {
      // Task tá»›i sá»›m. Cloud Tasks emulator KHÃ”NG há»— trá»£ scheduleTime (dispatch ngay) => bá» qua,
      // emulator dá»±a vÃ o claimTimeout cá»§a client. Production: Ä‘áº·t láº¡i task Ä‘Ãºng deadline.
      if (process.env.FUNCTIONS_EMULATOR === 'true') return;
      await getFunctions()
        .taskQueue(`locations/${REGION}/functions/clockTimeout`)
        .enqueue({ roomId, matchId, v, deadline }, { scheduleTime: new Date(deadline + 200), id: `${matchId}-v${v}-r${Date.now()}` })
        .catch((e) => logger.warn('re-enqueue failed', { matchId, e: String(e) }));
      return;
    }
    logger.info('clockTimeout', { matchId, v, code });
  },
);

/** Sweep dá»± phÃ²ng má»—i phÃºt: báº¯t cÃ¡c tráº­n quÃ¡ háº¡n náº¿u task bá»‹ trá»…/tháº¥t láº¡c â€“ ká»ƒ cáº£ khi cáº£ hai client Ä‘Ã£ Ä‘Ã³ng. */
export const sweepDeadlines = onSchedule({ region: REGION, schedule: 'every 1 minutes', timeZone: 'Asia/Ho_Chi_Minh' }, async () => {
  const now = Date.now();
  const snap = await rtdb().ref('deadlines').orderByChild('at').endAt(now - 1000).limitToFirst(100).get();
  const jobs: Promise<unknown>[] = [];
  snap.forEach((c) => {
    const { roomId } = c.val() as { roomId: string };
    const matchId = c.key!;
    jobs.push(
      checkTimeout(roomId, matchId).then(async (code) => {
        if (code === 'game_over' || code === 'not_found') await rtdb().ref(`deadlines/${matchId}`).remove();
      }),
    );
  });
  await Promise.allSettled(jobs);
});
