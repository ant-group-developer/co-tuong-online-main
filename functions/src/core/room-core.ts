/**
 * Lõi phòng (hàm thuần, chạy trong transaction trên rooms/{roomId}).
 * State machine: waiting -> ready -> playing -> finished ; waiting/ready -> cancelled.
 * Ba thuộc tính tách biệt: mode (ranked|friendly), visibility (public|private), role (player|spectator).
 */
import { LIMITS, TIME_CONTROLS } from '../config.js';
import { createMatchDoc } from './match-core.js';
import type { MatchDoc, RoomMode, RoomStatus, Visibility } from './types.js';

export type OwnerColor = 'red' | 'black' | 'random';
export type MemberRole = 'player' | 'spectator';

export interface SeatInfo {
  uid: string;
  name: string;
  ready: boolean;
  rating?: number | null;
}

export interface RoomMeta {
  roomId: string;
  ownerUid: string;
  ownerName: string;
  mode: RoomMode;
  visibility: Visibility;
  status: RoomStatus;
  tc: string;
  ownerColor: OwnerColor;
  createdAt: number;
  updatedAt: number;
  matchId: string | null;
  matchCount: number;
  /** uid -> true: người chơi muốn đấu lại (chỉ friendly). */
  rematch?: Record<string, boolean> | null;
}

export interface RoomDoc {
  meta: RoomMeta;
  seats?: { host?: SeatInfo | null; guest?: SeatInfo | null };
  members?: Record<string, { role: MemberRole; at: number }>;
  matches?: Record<string, MatchDoc>;
}

export type RoomCode =
  | 'ok'
  | 'not_found'
  | 'permission_denied'
  | 'seat_taken'
  | 'already_seated'
  | 'bad_state'
  | 'room_full'
  | 'not_allowed';

export interface RoomOutcome {
  commit: boolean;
  room: RoomDoc | null;
  code: RoomCode;
  message?: string;
  startedMatchId?: string;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const fail = (room: RoomDoc | null, code: RoomCode, message?: string): RoomOutcome => ({ commit: false, room, code, message });

export function newRoom(p: {
  roomId: string;
  owner: { uid: string; name: string };
  mode: RoomMode;
  visibility: Visibility;
  tc: string;
  ownerColor: OwnerColor;
  now: number;
}): RoomDoc {
  return {
    meta: {
      roomId: p.roomId,
      ownerUid: p.owner.uid,
      ownerName: p.owner.name,
      mode: p.mode,
      visibility: p.visibility,
      status: 'waiting',
      tc: p.tc,
      ownerColor: p.ownerColor,
      createdAt: p.now,
      updatedAt: p.now,
      matchId: null,
      matchCount: 0,
      rematch: null,
    },
    seats: { host: { uid: p.owner.uid, name: p.owner.name, ready: false }, guest: null },
    members: { [p.owner.uid]: { role: 'player', at: p.now } },
  };
}

function seatOf(room: RoomDoc, uid: string): 'host' | 'guest' | null {
  if (room.seats?.host?.uid === uid) return 'host';
  if (room.seats?.guest?.uid === uid) return 'guest';
  return null;
}

/** Quyền đọc phòng (dùng ở server để kiểm tra trước khi cho xem/nhận ghế). */
export function canView(room: RoomDoc, uid: string): boolean {
  return room.meta.visibility === 'public' || !!room.members?.[uid];
}

export function joinAsPlayer(current: RoomDoc | null, user: { uid: string; name: string }, now: number): RoomOutcome {
  if (!current) return fail(null, 'not_found', 'Phòng không tồn tại');
  const room = clone(current);
  const meta = room.meta;
  if (seatOf(room, user.uid)) return { commit: false, room: current, code: 'already_seated' };
  if (meta.mode !== 'friendly') return fail(current, 'not_allowed', 'Phòng xếp hạng do hệ thống ghép, không thể vào ghế');
  if (meta.status !== 'waiting') return fail(current, 'seat_taken', 'Phòng đã đủ người hoặc đã bắt đầu');
  if (meta.visibility === 'private') {
    const mem = room.members?.[user.uid];
    if (!mem) return fail(current, 'permission_denied', 'Bạn cần lời mời hợp lệ để vào phòng riêng tư');
    if (mem.role !== 'player') return fail(current, 'permission_denied', 'Lời mời của bạn chỉ có quyền xem');
  }
  if (room.seats?.guest) return fail(current, 'seat_taken', 'Ghế đã có người');
  room.seats = room.seats ?? {};
  room.seats.guest = { uid: user.uid, name: user.name, ready: false };
  room.members = room.members ?? {};
  if (Object.keys(room.members).length >= LIMITS.maxMembers && !room.members[user.uid]) return fail(current, 'room_full');
  room.members[user.uid] = { role: 'player', at: room.members[user.uid]?.at ?? now };
  meta.status = 'ready';
  meta.updatedAt = now;
  if (room.seats.host) room.seats.host.ready = false;
  return { commit: true, room, code: 'ok' };
}

export function leaveRoom(current: RoomDoc | null, uid: string, now: number): RoomOutcome {
  if (!current) return fail(null, 'not_found');
  const room = clone(current);
  const meta = room.meta;
  const seat = seatOf(room, uid);
  if (!seat) return { commit: false, room: current, code: 'ok' };
  if (meta.status === 'playing') return fail(current, 'bad_state', 'Trận đang diễn ra: hãy đầu hàng nếu muốn rời');
  if (meta.status === 'finished' || meta.status === 'cancelled') {
    if (meta.rematch?.[uid]) {
      delete meta.rematch[uid];
      meta.updatedAt = now;
      return { commit: true, room, code: 'ok' };
    }
    return { commit: false, room: current, code: 'ok' };
  }
  if (seat === 'host') {
    meta.status = 'cancelled';
  } else {
    room.seats!.guest = null;
    if (room.seats!.host) room.seats!.host.ready = false;
    meta.status = 'waiting';
    if (meta.visibility === 'public' && room.members) delete room.members[uid];
  }
  meta.updatedAt = now;
  return { commit: true, room, code: 'ok' };
}

export function kickGuest(current: RoomDoc | null, ownerUid: string, now: number): RoomOutcome {
  if (!current) return fail(null, 'not_found');
  if (current.meta.ownerUid !== ownerUid) return fail(current, 'permission_denied', 'Chỉ chủ phòng được mời khách ra');
  // Chặn "đá" đối thủ để né thua sau khi trận đã bắt đầu.
  if (current.meta.status !== 'waiting' && current.meta.status !== 'ready')
    return fail(current, 'bad_state', 'Không thể mời khách ra sau khi trận đã bắt đầu');
  const room = clone(current);
  const guest = room.seats?.guest;
  if (!guest) return { commit: false, room: current, code: 'ok' };
  room.seats!.guest = null;
  if (room.members) delete room.members[guest.uid];
  if (room.seats!.host) room.seats!.host.ready = false;
  room.meta.status = 'waiting';
  room.meta.updatedAt = now;
  return { commit: true, room, code: 'ok' };
}

export function updateSettings(
  current: RoomDoc | null,
  ownerUid: string,
  patch: { visibility?: Visibility; tc?: string; ownerColor?: OwnerColor },
  now: number,
): RoomOutcome {
  if (!current) return fail(null, 'not_found');
  if (current.meta.ownerUid !== ownerUid) return fail(current, 'permission_denied', 'Chỉ chủ phòng được đổi cài đặt');
  if (current.meta.status !== 'waiting' && current.meta.status !== 'ready')
    return fail(current, 'bad_state', 'Cài đặt đã bị khóa khi trận bắt đầu');
  if (patch.tc && !TIME_CONTROLS[patch.tc]) return fail(current, 'not_allowed', 'Thời gian không hợp lệ');
  const room = clone(current);
  if (patch.visibility) room.meta.visibility = patch.visibility;
  if (patch.tc) room.meta.tc = patch.tc;
  if (patch.ownerColor) room.meta.ownerColor = patch.ownerColor;
  // Đổi cài đặt => hủy trạng thái sẵn sàng để hai bên xác nhận lại.
  if (room.seats?.host) room.seats.host.ready = false;
  if (room.seats?.guest) room.seats.guest.ready = false;
  room.meta.updatedAt = now;
  return { commit: true, room, code: 'ok' };
}

function pickColors(room: RoomDoc, matchId: string): { red: SeatInfo; black: SeatInfo } {
  const host = room.seats!.host!;
  const guest = room.seats!.guest!;
  // Đấu lại: đổi màu so với trận trước.
  const prev = room.meta.matchId ? room.matches?.[room.meta.matchId] : undefined;
  if (prev) {
    return prev.players.red.uid === host.uid ? { red: guest, black: host } : { red: host, black: guest };
  }
  let hostRed: boolean;
  if (room.meta.ownerColor === 'red') hostRed = true;
  else if (room.meta.ownerColor === 'black') hostRed = false;
  else hostRed = matchId.charCodeAt(matchId.length - 1) % 2 === 0;
  return hostRed ? { red: host, black: guest } : { red: guest, black: host };
}

function startMatch(room: RoomDoc, matchId: string, now: number): void {
  const tc = TIME_CONTROLS[room.meta.tc];
  const colors = pickColors(room, matchId);
  const match = createMatchDoc({
    matchId,
    roomId: room.meta.roomId,
    mode: room.meta.mode,
    rated: room.meta.mode === 'ranked',
    visibility: room.meta.visibility,
    players: {
      red: { uid: colors.red.uid, name: colors.red.name, rating: colors.red.rating ?? null },
      black: { uid: colors.black.uid, name: colors.black.name, rating: colors.black.rating ?? null },
    },
    initialMs: tc.initialMs,
    incrementMs: tc.incrementMs,
    now,
  });
  room.matches = room.matches ?? {};
  room.matches[matchId] = match;
  room.meta.matchId = matchId;
  room.meta.matchCount = (room.meta.matchCount ?? 0) + 1;
  room.meta.status = 'playing';
  room.meta.rematch = null;
  room.meta.updatedAt = now;
  if (room.seats?.host) room.seats.host.ready = false;
  if (room.seats?.guest) room.seats.guest.ready = false;
}

export function setReady(current: RoomDoc | null, uid: string, ready: boolean, now: number, newMatchId: string): RoomOutcome {
  if (!current) return fail(null, 'not_found');
  const seat = seatOf(current, uid);
  if (!seat) return fail(current, 'permission_denied', 'Bạn không ngồi ở phòng này');
  if (current.meta.status !== 'ready' && current.meta.status !== 'waiting')
    return fail(current, 'bad_state', 'Không thể đổi trạng thái sẵn sàng lúc này');
  const room = clone(current);
  room.seats![seat]!.ready = ready;
  room.meta.updatedAt = now;
  if (room.meta.status === 'ready' && room.seats?.host?.ready && room.seats?.guest?.ready) {
    startMatch(room, newMatchId, now);
    return { commit: true, room, code: 'ok', startedMatchId: newMatchId };
  }
  return { commit: true, room, code: 'ok' };
}

export function requestRematch(current: RoomDoc | null, uid: string, now: number, newMatchId: string): RoomOutcome {
  if (!current) return fail(null, 'not_found');
  if (current.meta.mode !== 'friendly') return fail(current, 'not_allowed', 'Trận xếp hạng: hãy tìm trận mới');
  if (current.meta.status !== 'finished') return fail(current, 'bad_state', 'Chỉ đấu lại sau khi trận kết thúc');
  if (!seatOf(current, uid)) return fail(current, 'permission_denied');
  if (!current.seats?.host || !current.seats?.guest) return fail(current, 'bad_state', 'Thiếu người chơi');
  const room = clone(current);
  room.meta.rematch = { ...(room.meta.rematch ?? {}), [uid]: true };
  room.meta.updatedAt = now;
  const both = room.meta.rematch[room.seats!.host!.uid] && room.meta.rematch[room.seats!.guest!.uid];
  if (both) {
    startMatch(room, newMatchId, now);
    return { commit: true, room, code: 'ok', startedMatchId: newMatchId };
  }
  return { commit: true, room, code: 'ok' };
}

/** Phòng xếp hạng do matchmaking tạo – bắt đầu ngay, công khai cho người xem. */
export function newRankedRoom(p: {
  roomId: string;
  matchId: string;
  a: { uid: string; name: string; rating: number };
  b: { uid: string; name: string; rating: number };
  tc: string;
  now: number;
}): RoomDoc {
  const room = newRoom({
    roomId: p.roomId,
    owner: { uid: p.a.uid, name: p.a.name },
    mode: 'ranked',
    visibility: 'public',
    tc: p.tc,
    ownerColor: 'random',
    now: p.now,
  });
  room.seats = {
    host: { uid: p.a.uid, name: p.a.name, ready: true, rating: p.a.rating },
    guest: { uid: p.b.uid, name: p.b.name, ready: true, rating: p.b.rating },
  };
  room.members = { [p.a.uid]: { role: 'player', at: p.now }, [p.b.uid]: { role: 'player', at: p.now } };
  startMatch(room, p.matchId, p.now);
  return room;
}

/** Cập nhật trạng thái phòng khi trận hiện tại kết thúc (gọi sau commit của trận). */
export function onMatchFinished(current: RoomDoc | null, matchId: string, aborted: boolean, now: number): RoomOutcome {
  if (!current) return fail(null, 'not_found');
  if (current.meta.matchId !== matchId || current.meta.status !== 'playing') return { commit: false, room: current, code: 'ok' };
  const room = clone(current);
  room.meta.status = aborted && room.meta.mode === 'ranked' ? 'cancelled' : 'finished';
  room.meta.updatedAt = now;
  return { commit: true, room, code: 'ok' };
}
