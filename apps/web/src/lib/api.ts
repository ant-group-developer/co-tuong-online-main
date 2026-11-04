/**
 * Gọi Cloud Functions (callable). Client chỉ gửi intent; không bao giờ gửi bàn cờ/kết quả/rating.
 */
import { httpsCallable } from 'firebase/functions';
import i18n from '../i18n';
import { fb } from './firebase';

async function call<T>(name: string, data: unknown): Promise<T> {
  const fn = httpsCallable<unknown, T>(fb().fns, name, { timeout: 20_000 });
  const res = await fn(data);
  return res.data;
}

export function newCommandId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export type Tc = '5+0' | '10+5' | '15+10';
export const TC_OPTIONS: Array<{ id: Tc; ranked: boolean }> = [
  { id: '5+0', ranked: true },
  { id: '10+5', ranked: true },
  { id: '15+10', ranked: false },
];
export const tcLabel = (id: string): string => (i18n.exists(`tc.${id}`) ? i18n.t(`tc.${id}` as 'tc.5+0') : id);

export interface CommandResponse {
  ok: boolean;
  code: string;
  message: string | null;
  messageKey?: string | null;
  version: number | null;
  status: string | null;
}

export const api = {
  createRoom: (p: { visibility: 'public' | 'private'; tc: Tc; ownerColor: 'red' | 'black' | 'random' }) =>
    call<{ roomId: string }>('createRoom', p),
  joinRoom: (roomId: string, as: 'player' | 'spectator') => call<{ role: string; seated?: boolean }>('joinRoom', { roomId, as }),
  leaveRoom: (roomId: string) => call<{ ok: true }>('leaveRoom', { roomId }),
  setReady: (roomId: string, ready: boolean) => call<{ ok: true; startedMatchId: string | null }>('setReady', { roomId, ready }),
  updateRoomSettings: (roomId: string, patch: { visibility?: string; tc?: string; ownerColor?: string }) =>
    call<{ ok: true }>('updateRoomSettings', { roomId, ...patch }),
  kickGuest: (roomId: string) => call<{ ok: true }>('kickGuest', { roomId }),
  requestRematch: (roomId: string) => call<{ ok: true; startedMatchId: string | null }>('requestRematch', { roomId }),
  createInvite: (roomId: string, role: 'player' | 'spectator', ttlHours = 24) =>
    call<{ token: string; inviteId: string; role: string; expiresAt: number }>('createInvite', { roomId, role, ttlHours }),
  revokeInvite: (roomId: string, inviteId: string) => call<{ ok: true }>('revokeInvite', { roomId, inviteId }),
  redeemInvite: (token: string) => call<{ roomId: string; role: 'player' | 'spectator' }>('redeemInvite', { token }),
  submitMove: (p: { roomId: string; matchId: string; commandId: string; expectedVersion: number; from: string; to: string }) =>
    call<CommandResponse>('submitMove', p),
  matchAction: (p: {
    roomId: string;
    matchId: string;
    commandId: string;
    expectedVersion: number;
    type: 'resign' | 'offerDraw' | 'respondDraw' | 'requestUndo' | 'respondUndo' | 'claimTimeout' | 'claimAbandon';
    accept?: boolean;
  }) => call<CommandResponse>('matchAction', p),
  mmEnqueue: (tc: Tc) =>
    call<{ status: 'queued' | 'matched' | 'busy' | 'settling'; roomId: string | null; matchId: string | null; rating: number }>('mmEnqueue', { tc }),
  mmCancel: () => call<{ status: 'cancelled' | 'matched' | 'not_queued'; roomId: string | null }>('mmCancel', {}),
};

/** Nếu lỗi là "đang ở phòng khác": trả mã phòng đó. */
export function alreadyInRoomOf(e: unknown): string | null {
  const d = (e as { details?: { code?: string; roomId?: string } })?.details;
  return d?.code === 'already_in_room' && d.roomId ? d.roomId : null;
}

type Params = Record<string, unknown>;

/** Dịch một khóa thông báo của server (functions/src/messages.ts); null nếu không có bản dịch. */
function serverText(key: unknown, params: Params = {}): string | null {
  if (typeof key !== 'string' || !i18n.exists(`serverErrors.${key}`)) return null;
  // Khóa động (đến từ server) nên gọi t() không kiểm tra kiểu khóa.
  return (i18n.t as unknown as (k: string, o?: object) => string)(`serverErrors.${key}`, params);
}

/** Thông báo lỗi (theo ngôn ngữ đang chọn) từ lỗi Functions/Firebase. */
export function errorText(e: unknown): string {
  const err = e as { code?: string; message?: string; details?: Params & { key?: string } };
  const translated = serverText(err?.details?.key, err?.details ?? {});
  if (translated) return translated;
  const code = err?.code ?? '';
  if (code === 'functions/unavailable' || code === 'unavailable') return i18n.t('errors.unavailable');
  if (code === 'functions/deadline-exceeded') return i18n.t('errors.slow');
  if (code === 'functions/unauthenticated') return i18n.t('errors.signIn');
  if (code === 'PERMISSION_DENIED' || code === 'permission-denied' || /permission/i.test(err?.message ?? '')) return i18n.t('errors.permission');
  if (err?.message === 'FIREBASE_NOT_CONFIGURED') return i18n.t('errors.notConfigured');
  return err?.message || i18n.t('common.errorGeneric');
}

/** Thông báo cho phản hồi lệnh trận đấu (đi quân, cầu hòa…) bị từ chối. */
export function commandText(r: { code: string; message: string | null; messageKey?: string | null }): string {
  return serverText(r.messageKey) ?? (i18n.exists(`cmd.${r.code}`) ? i18n.t(`cmd.${r.code}` as 'cmd.not_allowed') : null) ?? r.message ?? r.code;
}
