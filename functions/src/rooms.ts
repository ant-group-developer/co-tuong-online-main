/**
 * Callable cho phÃ²ng báº¡n bÃ¨ + lá»i má»i phÃ²ng riÃªng tÆ°.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { LIMITS, REGION, TIME_CONTROLS } from './config.js';
import {
  joinAsPlayer,
  kickGuest,
  leaveRoom,
  newRoom,
  requestRematch,
  setReady,
  updateSettings,
  canView,
  type MemberRole,
  type OwnerColor,
  type RoomDoc,
  type RoomOutcome,
} from './core/room-core.js';
import type { Visibility } from './core/types.js';
import {
  ENFORCE_APP_CHECK,
  displayNameOf,
  hashToken,
  httpsErrorFor,
  newInviteToken,
  randomId,
  requireAuth,
  rtdb,
  runTx,
} from './firebase.js';
import { afterMatchStarted, syncPublicIndex } from './sync.js';

// invoker 'public': Cloud Run cho phép gọi; xác thực Firebase Auth vẫn do requireAuth/requireIdentified kiểm tra.
const callOpts = { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, cors: true, invoker: 'public' } as const;

const ROOM_ID_RE = /^[a-z0-9]{6,24}$/;

function str(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new HttpsError('invalid-argument', `Thiáº¿u ${field}`);
  return v;
}

function roomIdOf(data: unknown): string {
  const id = str((data as { roomId?: unknown })?.roomId, 'roomId');
  if (!ROOM_ID_RE.test(id)) throw new HttpsError('invalid-argument', 'MÃ£ phÃ²ng khÃ´ng há»£p lá»‡');
  return id;
}

function parseVisibility(v: unknown): Visibility {
  if (v !== 'public' && v !== 'private') throw new HttpsError('invalid-argument', 'visibility pháº£i lÃ  public hoáº·c private');
  return v;
}

function parseColor(v: unknown): OwnerColor {
  if (v === undefined) return 'random';
  if (v !== 'red' && v !== 'black' && v !== 'random') throw new HttpsError('invalid-argument', 'MÃ u khÃ´ng há»£p lá»‡');
  return v;
}

function parseTc(v: unknown): string {
  if (typeof v !== 'string' || !TIME_CONTROLS[v]) throw new HttpsError('invalid-argument', 'Thá»i gian khÃ´ng há»£p lá»‡');
  return v;
}

/** Giá»›i háº¡n táº§n suáº¥t theo UID (transaction RTDB, cÃ³ thá»ƒ phá»¥c há»“i sau khi Function khá»Ÿi Ä‘á»™ng láº¡i). */
export async function rateLimit(uid: string, action: string, max: number, windowMs: number): Promise<void> {
  const now = Date.now();
  let allowed = false;
  await rtdb()
    .ref(`rateLimits/${uid}/${action}`)
    .transaction((cur: number[] | null) => {
      const recent = (Array.isArray(cur) ? cur : []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        allowed = false;
        return; // abort
      }
      allowed = true;
      recent.push(now);
      return recent;
    });
  if (!allowed) throw httpsErrorFor('rate_limited');
}

async function roomTx(roomId: string, fn: (cur: RoomDoc | null) => RoomOutcome): Promise<RoomOutcome> {
  const { result } = await runTx<RoomDoc, RoomOutcome & { value?: RoomDoc | null }>(rtdb().ref(`rooms/${roomId}`), (cur) => {
    const r = fn(cur);
    return { ...r, value: r.room };
  });
  if (result.code !== 'ok' && result.code !== 'already_seated') throw httpsErrorFor(result.code, result.message);
  if (result.commit && result.room) await syncPublicIndex(result.room);
  if (result.startedMatchId && result.room) await afterMatchStarted(result.room, result.startedMatchId);
  return result;
}

export const createRoom = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const visibility = parseVisibility(d.visibility);
  const tc = parseTc(d.tc ?? '10+5');
  const ownerColor = parseColor(d.ownerColor);
  await rateLimit(user.uid, 'createRoom', LIMITS.createRoomPer10Min, 10 * 60_000);
  const name = await displayNameOf(user);
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = randomId(8);
    const now = Date.now();
    let created = false;
    const res = await rtdb()
      .ref(`rooms/${roomId}`)
      .transaction((cur: RoomDoc | null) => {
        if (cur !== null) {
          created = false;
          return; // trÃ¹ng mÃ£, thá»­ mÃ£ khÃ¡c
        }
        created = true;
        return newRoom({ roomId, owner: { uid: user.uid, name }, mode: 'friendly', visibility, tc, ownerColor, now });
      });
    if (res.committed && created) {
      await syncPublicIndex(res.snapshot.val() as RoomDoc);
      return { roomId };
    }
  }
  throw new HttpsError('internal', 'KhÃ´ng táº¡o Ä‘Æ°á»£c phÃ²ng, hÃ£y thá»­ láº¡i');
});

export const joinRoom = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const roomId = roomIdOf(req.data);
  const as = (req.data as { as?: string }).as === 'spectator' ? 'spectator' : 'player';
  if (as === 'spectator') {
    const snap = await rtdb().ref(`rooms/${roomId}`).get();
    const room = snap.val() as RoomDoc | null;
    if (!room) throw httpsErrorFor('not_found', 'PhÃ²ng khÃ´ng tá»“n táº¡i');
    if (!canView(room, user.uid)) throw httpsErrorFor('permission_denied', 'PhÃ²ng riÃªng tÆ°: cáº§n lá»i má»i');
    return { role: 'spectator' as MemberRole };
  }
  const name = await displayNameOf(user);
  const r = await roomTx(roomId, (cur) => joinAsPlayer(cur, { uid: user.uid, name }, Date.now()));
  return { role: 'player' as MemberRole, seated: r.code === 'ok' || r.code === 'already_seated' };
});

export const leaveRoomFn = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const roomId = roomIdOf(req.data);
  await roomTx(roomId, (cur) => leaveRoom(cur, user.uid, Date.now()));
  return { ok: true };
});

export const setReadyFn = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const roomId = roomIdOf(req.data);
  const ready = (req.data as { ready?: unknown }).ready === true;
  const matchId = randomId(20);
  const r = await roomTx(roomId, (cur) => setReady(cur, user.uid, ready, Date.now(), matchId));
  return { ok: true, startedMatchId: r.startedMatchId ?? null };
});

export const updateRoomSettings = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const roomId = roomIdOf(req.data);
  const d = req.data as Record<string, unknown>;
  const patch = {
    visibility: d.visibility !== undefined ? parseVisibility(d.visibility) : undefined,
    tc: d.tc !== undefined ? parseTc(d.tc) : undefined,
    ownerColor: d.ownerColor !== undefined ? parseColor(d.ownerColor) : undefined,
  };
  await roomTx(roomId, (cur) => updateSettings(cur, user.uid, patch, Date.now()));
  return { ok: true };
});

export const kickGuestFn = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const roomId = roomIdOf(req.data);
  await roomTx(roomId, (cur) => kickGuest(cur, user.uid, Date.now()));
  return { ok: true };
});

export const requestRematchFn = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const roomId = roomIdOf(req.data);
  const matchId = randomId(20);
  const r = await roomTx(roomId, (cur) => requestRematch(cur, user.uid, Date.now(), matchId));
  return { ok: true, startedMatchId: r.startedMatchId ?? null };
});

// ---------------- Lá»i má»i (private ACL) ----------------

interface InviteRecord {
  inviteId: string;
  roomId: string;
  role: MemberRole;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
}

export const createInvite = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const roomId = roomIdOf(req.data);
  const role: MemberRole = (req.data as { role?: string }).role === 'spectator' ? 'spectator' : 'player';
  const ttlHours = Number((req.data as { ttlHours?: unknown }).ttlHours ?? 24);
  const ttlMs = Math.min(LIMITS.inviteMaxTtlMs, Math.max(10 * 60_000, (Number.isFinite(ttlHours) ? ttlHours : 24) * 3600_000));
  const metaSnap = await rtdb().ref(`rooms/${roomId}/meta`).get();
  const meta = metaSnap.val() as RoomDoc['meta'] | null;
  if (!meta) throw httpsErrorFor('not_found', 'PhÃ²ng khÃ´ng tá»“n táº¡i');
  if (meta.ownerUid !== user.uid) throw httpsErrorFor('permission_denied', 'Chá»‰ chá»§ phÃ²ng Ä‘Æ°á»£c táº¡o lá»i má»i');
  if (meta.mode !== 'friendly') throw httpsErrorFor('not_allowed', 'PhÃ²ng xáº¿p háº¡ng khÃ´ng dÃ¹ng lá»i má»i');
  if (meta.status === 'cancelled') throw httpsErrorFor('bad_state', 'PhÃ²ng Ä‘Ã£ bá»‹ há»§y');
  const existing = await rtdb().ref(`roomInvites/${roomId}`).get();
  if (existing.numChildren() >= LIMITS.maxInvitesPerRoom) throw httpsErrorFor('rate_limited', 'ÄÃ£ Ä‘áº¡t giá»›i háº¡n sá»‘ lá»i má»i cá»§a phÃ²ng');
  const { token, hash } = newInviteToken();
  const inviteId = randomId(12);
  const now = Date.now();
  const rec: InviteRecord = { inviteId, roomId, role, createdBy: user.uid, createdAt: now, expiresAt: now + ttlMs, revoked: false };
  await rtdb()
    .ref()
    .update({
      [`invites/${hash}`]: rec,
      [`roomInvites/${roomId}/${inviteId}`]: { role, createdAt: now, expiresAt: rec.expiresAt, revoked: false, tokenHash: hash },
    });
  // Token gá»‘c chá»‰ tráº£ vá» Má»˜T Láº¦N cho chá»§ phÃ²ng; server chá»‰ lÆ°u hash.
  return { token, inviteId, role, expiresAt: rec.expiresAt };
});

export const revokeInvite = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const roomId = roomIdOf(req.data);
  const inviteId = str((req.data as { inviteId?: unknown }).inviteId, 'inviteId');
  const meta = (await rtdb().ref(`rooms/${roomId}/meta`).get()).val() as RoomDoc['meta'] | null;
  if (!meta) throw httpsErrorFor('not_found');
  if (meta.ownerUid !== user.uid) throw httpsErrorFor('permission_denied', 'Chá»‰ chá»§ phÃ²ng Ä‘Æ°á»£c thu há»“i lá»i má»i');
  const inv = (await rtdb().ref(`roomInvites/${roomId}/${inviteId}`).get()).val() as { tokenHash: string } | null;
  if (!inv) throw httpsErrorFor('not_found', 'Lá»i má»i khÃ´ng tá»“n táº¡i');
  await rtdb()
    .ref()
    .update({ [`invites/${inv.tokenHash}/revoked`]: true, [`roomInvites/${roomId}/${inviteId}/revoked`]: true });
  return { ok: true };
});

export const redeemInvite = onCall(callOpts, async (req) => {
  const user = requireAuth(req);
  const token = str((req.data as { token?: unknown }).token, 'token');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw httpsErrorFor('permission_denied', 'Lá»i má»i khÃ´ng há»£p lá»‡');
  await rateLimit(user.uid, 'redeemInvite', 20, 10 * 60_000);
  const inv = (await rtdb().ref(`invites/${hashToken(token)}`).get()).val() as InviteRecord | null;
  const now = Date.now();
  if (!inv) throw httpsErrorFor('permission_denied', 'Lá»i má»i khÃ´ng há»£p lá»‡');
  if (inv.revoked) throw httpsErrorFor('permission_denied', 'Lá»i má»i Ä‘Ã£ bá»‹ thu há»“i');
  if (inv.expiresAt < now) throw httpsErrorFor('permission_denied', 'Lá»i má»i Ä‘Ã£ háº¿t háº¡n');
  let role: MemberRole = inv.role;
  await roomTx(inv.roomId, (cur) => {
    if (!cur) return { commit: false, room: null, code: 'not_found', message: 'PhÃ²ng khÃ´ng tá»“n táº¡i' };
    if (cur.meta.status === 'cancelled') return { commit: false, room: cur, code: 'bad_state', message: 'PhÃ²ng Ä‘Ã£ bá»‹ há»§y' };
    const room = JSON.parse(JSON.stringify(cur)) as RoomDoc;
    room.members = room.members ?? {};
    const existing = room.members[user.uid];
    // KhÃ´ng háº¡ quyá»n ngÆ°á»i Ä‘Ã£ lÃ  player; lá»i má»i xem khÃ´ng cáº¥p quyá»n vÃ o gháº¿.
    role = existing?.role === 'player' ? 'player' : inv.role;
    if (existing && existing.role === role) return { commit: false, room: cur, code: 'ok' };
    if (!existing && Object.keys(room.members).length >= LIMITS.maxMembers) return { commit: false, room: cur, code: 'room_full', message: 'PhÃ²ng Ä‘Ã£ Ä‘á»§ thÃ nh viÃªn' };
    room.members[user.uid] = { role, at: existing?.at ?? now };
    return { commit: true, room, code: 'ok' };
  });
  return { roomId: inv.roomId, role };
});
