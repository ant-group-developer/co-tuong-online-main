/**
 * Gọi Cloud Functions (callable). Client chỉ gửi intent; không bao giờ gửi bàn cờ/kết quả/rating.
 */
import { httpsCallable } from 'firebase/functions';
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
export const TC_OPTIONS: Array<{ id: Tc; label: string; ranked: boolean }> = [
  { id: '5+0', label: '5 phút', ranked: true },
  { id: '10+5', label: '10 phút + 5 giây', ranked: true },
  { id: '15+10', label: '15 phút + 10 giây', ranked: false },
];
export const tcLabel = (id: string) => TC_OPTIONS.find((t) => t.id === id)?.label ?? id;

export interface CommandResponse {
  ok: boolean;
  code: string;
  message: string | null;
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

/** Thông báo lỗi tiếng Việt từ lỗi Functions/Firebase. */
export function errorVi(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? '';
  if (code === 'functions/unavailable' || code === 'unavailable') return 'Không kết nối được máy chủ, hãy thử lại';
  if (code === 'functions/deadline-exceeded') return 'Máy chủ phản hồi chậm, hãy thử lại';
  if (code === 'functions/unauthenticated') return 'Bạn cần đăng nhập';
  if (code === 'PERMISSION_DENIED' || code === 'permission-denied' || /permission/i.test(err?.message ?? ''))
    return err?.message && !/^PERMISSION_DENIED|permission_denied|Missing or insufficient/i.test(err.message)
      ? err.message
      : 'Bạn không có quyền truy cập';
  if (err?.message === 'FIREBASE_NOT_CONFIGURED') return 'Chưa cấu hình Firebase cho chế độ online';
  return err?.message || 'Đã có lỗi xảy ra';
}
