import { initializeApp, getApps } from 'firebase-admin/app';
import { getDatabase, type Reference } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { randomBytes, createHash } from 'node:crypto';

if (getApps().length === 0) initializeApp();

export const rtdb = () => getDatabase();
export const fs = () => getFirestore();

/**
 * Bật bắt buộc App Check cho callable: đặt `ENFORCE_APP_CHECK=true` trong `functions/.env` rồi deploy lại.
 * Đọc env thường (CLI nạp functions/.env lúc phân tích deploy) – mặc định tắt, chạy được cả emulator lẫn deploy không tương tác.
 */
export const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';

export interface AuthedUser {
  uid: string;
  anonymous: boolean;
  name: string;
}

export function requireAuth(req: CallableRequest<unknown>): AuthedUser {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập');
  const token = req.auth.token as Record<string, unknown> & { firebase?: { sign_in_provider?: string } };
  const anonymous = token.firebase?.sign_in_provider === 'anonymous';
  const raw = (typeof token.name === 'string' && token.name) || (typeof token.email === 'string' && token.email.split('@')[0]) || '';
  return { uid: req.auth.uid, anonymous, name: sanitizeName(raw) || (anonymous ? 'Khách' : 'Người chơi') };
}

export function requireIdentified(req: CallableRequest<unknown>): AuthedUser {
  const u = requireAuth(req);
  if (u.anonymous) throw new HttpsError('permission-denied', 'Đấu xếp hạng cần tài khoản (Google hoặc email), không dùng tài khoản khách');
  return u;
}

export function sanitizeName(s: string): string {
  return s
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 24);
}

/** Tên hiển thị: ưu tiên publicProfiles (người dùng tự đặt, đã validate), sau đó token. */
export async function displayNameOf(user: AuthedUser): Promise<string> {
  try {
    const snap = await fs().doc(`publicProfiles/${user.uid}`).get();
    const n = snap.exists ? sanitizeName(String(snap.get('displayName') ?? '')) : '';
    return n || user.name;
  } catch {
    return user.name;
  }
}

export function randomId(len = 20): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

/** Token mời: 32 byte ngẫu nhiên (256 bit) base64url; server chỉ lưu SHA-256. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Transaction RTDB với hàm thuần `fn`. Callback có thể chạy nhiều lần; chỉ kết quả của lần chạy CUỐI được trả về.
 * Admin SDK có thể gọi callback lần đầu với null (cache rỗng) – khi đó trả lại null để SDK đọc giá trị thật và chạy lại.
 */
export async function runTx<T, R extends { commit: boolean }>(
  ref: Reference,
  fn: (current: T | null) => R & { value?: T | null },
  opts: { allowCreate?: boolean } = {},
): Promise<{ result: R; committed: boolean; value: T | null }> {
  let last: R | null = null;
  let sawNull = false;
  const res = await ref.transaction(
    (current: T | null) => {
      if (current === null && !opts.allowCreate && !sawNull) {
        sawNull = true;
        // Lần đầu: có thể chỉ là cache rỗng. Trả về null (không đổi) để SDK so khớp với server.
        last = fn(null);
        return null;
      }
      const r = fn(current);
      last = r;
      if (!r.commit) return; // abort, không ghi
      return r.value as T;
    },
    undefined,
    false,
  );
  return { result: last as unknown as R, committed: res.committed, value: res.snapshot.val() as T | null };
}

export function httpsErrorFor(code: string, message?: string): HttpsError {
  switch (code) {
    case 'not_found':
      return new HttpsError('not-found', message ?? 'Không tìm thấy');
    case 'permission_denied':
    case 'not_player':
      return new HttpsError('permission-denied', message ?? 'Không có quyền');
    case 'bad_request':
      return new HttpsError('invalid-argument', message ?? 'Yêu cầu không hợp lệ');
    case 'rate_limited':
      return new HttpsError('resource-exhausted', message ?? 'Thao tác quá nhanh, hãy thử lại sau');
    default:
      return new HttpsError('failed-precondition', message ?? code, { code });
  }
}
