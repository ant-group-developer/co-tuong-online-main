/**
 * Äáº¥u xáº¿p háº¡ng: server ghÃ©p Ä‘á»‘i thá»§ theo rating + time control. Link báº¡n bÃ¨ KHÃ”NG dÃ¹ng Ä‘Æ°á»£c cho ranked.
 * Client gá»i mmEnqueue Ä‘á»‹nh ká»³ (~4s) khi Ä‘ang chá»: vá»«a lÃ m "heartbeat", vá»«a má»Ÿ rá»™ng khoáº£ng rating theo thá»i gian.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { RANKED_TIME_CONTROLS, RATING_CONFIG, REGION } from './config.js';
import { mmCancel, mmEnqueue, type Assignment, type MmState } from './core/matchmaking-core.js';
import { newRankedRoom, type RoomDoc } from './core/room-core.js';
import { ENFORCE_APP_CHECK, displayNameOf, fs, randomId, requireIdentified, rtdb } from './firebase.js';
import { afterMatchStarted, syncPublicIndex } from './sync.js';

// invoker 'public': Cloud Run cho phép gọi; xác thực Firebase Auth vẫn do requireAuth/requireIdentified kiểm tra.
const callOpts = { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, cors: true, invoker: 'public' } as const;

async function currentRating(uid: string): Promise<number> {
  const snap = await fs().doc(`playerStats/${uid}`).get();
  const r = snap.exists ? Number(snap.get('rating')) : NaN;
  return Number.isFinite(r) ? r : RATING_CONFIG.initial;
}

/** Táº¡o phÃ²ng xáº¿p háº¡ng cho cáº·p Ä‘Ã£ ghÃ©p â€“ idempotent (táº¡o náº¿u chÆ°a cÃ³). */
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
      return; // Ä‘Ã£ tá»“n táº¡i
    }
    // MÃ u ngáº«u nhiÃªn theo matchId (khÃ´ng do client chá»n)
    const swap = pair.matchId.charCodeAt(0) % 2 === 1;
    const room = newRankedRoom({ ...pair, a: swap ? pair.b : pair.a, b: swap ? pair.a : pair.b, now: Date.now() });
    created = room;
    return room;
  });
  if (created) {
    const room = created as RoomDoc;
    await syncPublicIndex(room);
    await afterMatchStarted(room, pair.matchId);
  }
}

export const mmEnqueueFn = onCall(callOpts, async (req) => {
  const user = requireIdentified(req);
  const tc = (req.data as { tc?: unknown })?.tc;
  if (typeof tc !== 'string' || !RANKED_TIME_CONTROLS.includes(tc)) throw new HttpsError('invalid-argument', 'Thá»i gian khÃ´ng há»£p lá»‡ cho Ä‘áº¥u xáº¿p háº¡ng');
  const [rating, name] = await Promise.all([currentRating(user.uid), displayNameOf(user)]);
  let outcome: ReturnType<typeof mmEnqueue> | null = null;
  await rtdb()
    .ref('mm')
    .transaction((cur: MmState | null) => {
      const now = Date.now();
      // ID sinh má»›i má»—i láº§n cháº¡y láº¡i; chá»‰ láº§n cháº¡y commit cuá»‘i cÃ¹ng Ä‘Æ°á»£c dÃ¹ng.
      outcome = mmEnqueue(cur, { uid: user.uid, name, rating, tc }, now, () => ({ roomId: randomId(10), matchId: randomId(20) }));
      if (outcome.status === 'matched' && !outcome.newPair) return; // khÃ´ng Ä‘á»•i gÃ¬
      if (outcome.status === 'busy') return;
      return outcome.state;
    });
  const o = outcome as ReturnType<typeof mmEnqueue> | null;
  if (!o) throw new HttpsError('internal', 'Lá»—i hÃ ng chá»');
  if (o.newPair) {
    const { a, b, roomId, matchId } = o.newPair;
    await ensureRankedRoom({ roomId, matchId, a, b, tc });
  } else if (o.status === 'matched' && o.assignment) {
    const roomStatus = (await rtdb().ref(`rooms/${o.assignment.roomId}/meta/status`).get()).val() as string | null;
    if (roomStatus === 'finished' || roomStatus === 'cancelled') {
      // Tráº­n rated trÆ°á»›c Ä‘Ã£ xong nhÆ°ng káº¿t quáº£ chÆ°a ghi xong vÃ o Firestore: chÆ°a cho vÃ o hÃ ng chá»
      // Ä‘á»ƒ khÃ´ng ghÃ©p báº±ng rating cÅ©. Client thá»­ láº¡i sau vÃ i giÃ¢y.
      return { status: 'settling', roomId: null, matchId: o.assignment.matchId, rating };
    }
    // Phá»¥c há»“i: Ä‘Ã£ ghÃ©p nhÆ°ng phÃ²ng chÆ°a Ä‘Æ°á»£c táº¡o (vÃ­ dá»¥ Function trÆ°á»›c bá»‹ dá»«ng giá»¯a chá»«ng).
    if (roomStatus === null) {
      const opp = o.assignment.opponentUid;
      const oppName = ((await fs().doc(`publicProfiles/${opp}`).get()).get('displayName') as string) || 'Äá»‘i thá»§';
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
  const user = requireIdentified(req);
  let status: 'cancelled' | 'matched' | 'not_queued' = 'not_queued';
  let assignment: Assignment | undefined;
  await rtdb()
    .ref('mm')
    .transaction((cur: MmState | null) => {
      // Admin SDK cÃ³ thá»ƒ gá»i láº§n Ä‘áº§u vá»›i null (cache rá»—ng): tráº£ null Ä‘á»ƒ SDK Ä‘á»c giÃ¡ trá»‹ tháº­t rá»“i cháº¡y láº¡i.
      // KHÃ”NG abort á»Ÿ láº§n nÃ y, náº¿u khÃ´ng sáº½ bÃ¡o 'not_queued' sai khi ngÆ°á»i chÆ¡i Ä‘Ã£ Ä‘Æ°á»£c ghÃ©p.
      if (cur === null) return null;
      const r = mmCancel(cur, user.uid);
      status = r.status;
      assignment = r.assignment;
      if (r.status !== 'cancelled') return;
      return r.state;
    });
  // Race cancel vs matched: náº¿u Ä‘Ã£ ghÃ©p xong thÃ¬ khÃ´ng há»§y Ä‘Æ°á»£c, tráº£ vá» phÃ²ng Ä‘á»ƒ client vÃ o tráº­n.
  return { status, roomId: (assignment as Assignment | undefined)?.roomId ?? null };
});
