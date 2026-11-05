/**
 * Đăng nhập & hồ sơ.
 * - Mỗi trình duyệt tự có một tài khoản KHÁCH (Firebase Anonymous Auth) ngay lần đầu vào web.
 *   ID khách = 6 ký tự đầu của UID (viết hoa), lưu trong Firestore `publicProfiles/{uid}` cùng tên hiển thị.
 * - Khách đăng nhập Google/email: tài khoản được NỐI (link) vào chính UID khách đó, nên giữ nguyên rating/lịch sử.
 *   Nếu Google/email đã thuộc tài khoản khác thì chuyển sang tài khoản đó (dữ liệu khách cũ ở lại với UID khách).
 */
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import i18n from '../i18n';
import { DEFAULT_AVATAR, isAvatarId, type AvatarId } from './avatars';
import { fb, firebaseConfigured } from './firebase';

export interface AuthState {
  ready: boolean;
  user: User | null;
  /** Tên hiển thị công khai (publicProfiles). */
  displayName: string;
  /** ID người chơi (6 ký tự), cố định theo tài khoản. */
  code: string;
  isAnonymous: boolean;
  /** 'google.com' | 'password' | 'anonymous' | '' */
  provider: string;
  email: string | null;
  /** Nhân vật 3D đã chọn (mặc định Thư sinh). */
  avatar: AvatarId;
  configured: boolean;
  ensureSignedIn: () => Promise<User>;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  saveDisplayName: (name: string) => Promise<void>;
  saveAvatar: (avatar: AvatarId) => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function cleanName(s: string): string {
  return s.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 24);
}

export function codeOf(uid: string): string {
  return uid.slice(0, 6).toUpperCase();
}

/** Tên khách mặc định theo ngôn ngữ đang chọn ("Khách ABC123" / "Guest ABC123"). */
export function guestNameOf(uid: string): string {
  return i18n.t('profile.guestName', { code: codeOf(uid) });
}

/** Mọi dạng tên khách mặc định (mọi ngôn ngữ) – để nhận ra tên chưa được người dùng đổi. */
function isDefaultGuestName(name: string, uid: string): boolean {
  const code = codeOf(uid);
  return Object.keys(i18n.options.resources ?? {}).some((lng) => i18n.getFixedT(lng)('profile.guestName', { code }) === name);
}

function providerOf(u: User | null): string {
  if (!u) return '';
  if (u.isAnonymous) return 'anonymous';
  return u.providerData[0]?.providerId ?? 'password';
}

interface Profile {
  displayName: string;
  code: string;
  avatar?: AvatarId | null;
}

/** Giữ nguyên trường nhân vật khi ghi lại hồ sơ (setDoc ghi đè cả tài liệu). */
function avatarField(v: unknown): { avatar?: AvatarId } {
  return isAvatarId(v) ? { avatar: v } : {};
}

const PROFILE_CACHE_KEY = 'xq.profile.cache.v1';

function readCachedProfile(uid: string): Profile | null {
  try {
    const v = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) ?? 'null') as (Profile & { uid: string }) | null;
    return v && v.uid === uid && v.displayName ? { displayName: v.displayName, code: v.code, avatar: isAvatarId(v.avatar) ? v.avatar : null } : null;
  } catch {
    return null;
  }
}

function cacheProfile(uid: string, p: Profile): void {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ uid, ...p }));
  } catch {
    /* bỏ qua */
  }
}

/**
 * Tạo hoặc cập nhật hồ sơ công khai: gán ID, đồng bộ cờ khách, và khi khách vừa nối tài khoản
 * thì thay tên mặc định "Khách XXXXXX" bằng tên thật (nếu có).
 */
async function ensureProfile(user: User, preferred?: string): Promise<Profile> {
  const { fs } = fb();
  const ref = doc(fs, 'publicProfiles', user.uid);
  const snap = await getDoc(ref);
  const code = codeOf(user.uid);
  const isGuest = user.isAnonymous;
  const realName = cleanName(preferred || user.displayName || user.email?.split('@')[0] || '');
  if (snap.exists()) {
    const cur = String(snap.get('displayName') ?? '');
    const wasDefault = isDefaultGuestName(cur, user.uid) || cur.length < 2;
    const name = !isGuest && wasDefault && realName.length >= 2 ? realName : cur.length >= 2 ? cur : guestNameOf(user.uid);
    const photo = !isGuest && user.photoURL?.startsWith('https://') ? user.photoURL : (snap.get('photoURL') ?? null);
    const av = snap.get('avatar') as unknown;
    if (snap.get('code') !== code || snap.get('isGuest') !== isGuest || name !== cur || photo !== (snap.get('photoURL') ?? null)) {
      await setDoc(ref, { displayName: name, photoURL: photo, code, isGuest, ...avatarField(av), createdAt: snap.get('createdAt'), updatedAt: serverTimestamp() });
    }
    return { displayName: name, code, avatar: isAvatarId(av) ? av : null };
  }
  const name = !isGuest && realName.length >= 2 ? realName : guestNameOf(user.uid);
  await setDoc(ref, {
    displayName: name,
    photoURL: !isGuest && user.photoURL?.startsWith('https://') ? user.photoURL : null,
    code,
    isGuest,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { displayName: name, code };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!firebaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile>({ displayName: '', code: '', avatar: null });
  // User của Firebase là object bị sửa tại chỗ khi link → dùng bộ đếm để React cập nhật.
  const [rev, setRev] = useState(0);
  const anonPending = useRef<Promise<User> | null>(null);

  const refresh = useCallback(async (u: User | null, preferred?: string) => {
    setUser(u);
    setRev((r) => r + 1);
    if (!u) {
      setProfile({ displayName: '', code: '' });
      return;
    }
    // Hiện ngay tên đã lưu lần trước (hoặc tên mặc định) trong lúc chờ Firestore, tránh menu trống.
    setProfile((p) => (p.code === codeOf(u.uid) ? p : (readCachedProfile(u.uid) ?? { displayName: u.isAnonymous ? guestNameOf(u.uid) : (u.displayName ?? guestNameOf(u.uid)), code: codeOf(u.uid) })));
    try {
      const p = await ensureProfile(u, preferred);
      cacheProfile(u.uid, p);
      setProfile(p);
    } catch {
      setProfile({ displayName: u.isAnonymous ? guestNameOf(u.uid) : (u.displayName ?? i18n.t('profile.playerName', { code: codeOf(u.uid) })), code: codeOf(u.uid) });
    }
  }, []);

  const ensureSignedIn = useCallback(async () => {
    const { auth } = fb();
    if (auth.currentUser) return auth.currentUser;
    // Gộp nhiều lời gọi đồng thời thành một lần tạo khách.
    anonPending.current ??= signInAnonymously(auth)
      .then(async (c) => {
        // Ghi hồ sơ (tên "Khách/Guest <ID>" theo ngôn ngữ) TRƯỚC khi trả về, để lệnh tiếp theo (tạo phòng…)
        // không dùng tên dự phòng của server.
        await ensureProfile(c.user).catch(() => undefined);
        return c.user;
      })
      .finally(() => {
        anonPending.current = null;
      });
    return anonPending.current;
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) return;
    const { auth } = fb();
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        // Chưa có tài khoản (lần đầu vào web, hoặc vừa đăng xuất): tự tạo tài khoản khách.
        await refresh(null);
        try {
          await ensureSignedIn();
          return; // onAuthStateChanged sẽ chạy lại với user khách
        } catch {
          setReady(true);
          return;
        }
      }
      await refresh(u);
      setReady(true);
    });
  }, [refresh, ensureSignedIn]);

  const afterSignIn = useCallback(
    async (cred: UserCredential, preferred?: string) => {
      // Token phải làm mới để server thấy loại đăng nhập mới (không còn là khách).
      await cred.user.getIdToken(true);
      await refresh(cred.user, preferred);
    },
    [refresh],
  );

  const value = useMemo<AuthState>(
    () => ({
      ready,
      user,
      displayName: profile.displayName,
      code: profile.code,
      isAnonymous: !!user?.isAnonymous,
      provider: providerOf(user),
      email: user?.email ?? null,
      avatar: profile.avatar ?? DEFAULT_AVATAR,
      configured: firebaseConfigured,
      ensureSignedIn,
      signInGoogle: async () => {
        const { auth } = fb();
        const provider = new GoogleAuthProvider();
        const cur = auth.currentUser;
        let cred: UserCredential;
        if (cur?.isAnonymous) {
          try {
            cred = await linkWithPopup(cur, provider);
          } catch (e) {
            const code = (e as { code?: string }).code;
            const existing = GoogleAuthProvider.credentialFromError(e as never);
            if ((code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') && existing) {
              cred = await signInWithCredential(auth, existing);
            } else throw e;
          }
        } else {
          cred = await signInWithPopup(auth, provider);
        }
        await afterSignIn(cred);
      },
      signInEmail: async (email, password) => {
        const { auth } = fb();
        await afterSignIn(await signInWithEmailAndPassword(auth, email, password));
      },
      signUpEmail: async (email, password, name) => {
        const { auth } = fb();
        const n = cleanName(name);
        const cur = auth.currentUser;
        const cred = cur?.isAnonymous
          ? await linkWithCredential(cur, EmailAuthProvider.credential(email, password))
          : await createUserWithEmailAndPassword(auth, email, password);
        if (n.length >= 2) await updateProfile(cred.user, { displayName: n });
        await afterSignIn(cred, n);
      },
      signOut: async () => {
        await fbSignOut(fb().auth);
      },
      saveDisplayName: async (name) => {
        const u = fb().auth.currentUser;
        if (!u) throw new Error(i18n.t('authErrors.notSignedIn'));
        const n = cleanName(name);
        if (n.length < 2) throw new Error(i18n.t('profile.nameLength'));
        const ref = doc(fb().fs, 'publicProfiles', u.uid);
        const snap = await getDoc(ref);
        await setDoc(ref, {
          displayName: n,
          photoURL: snap.get('photoURL') ?? null,
          code: codeOf(u.uid),
          isGuest: u.isAnonymous,
          ...avatarField(snap.get('avatar')),
          createdAt: snap.get('createdAt') ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const p = { displayName: n, code: codeOf(u.uid), avatar: isAvatarId(snap.get('avatar')) ? (snap.get('avatar') as AvatarId) : null };
        setProfile(p);
        cacheProfile(u.uid, p);
      },
      saveAvatar: async (avatar) => {
        const u = fb().auth.currentUser;
        if (!u) throw new Error(i18n.t('authErrors.notSignedIn'));
        if (!isAvatarId(avatar)) return;
        const ref = doc(fb().fs, 'publicProfiles', u.uid);
        const snap = await getDoc(ref);
        const name = String(snap.get('displayName') ?? '') || guestNameOf(u.uid);
        await setDoc(ref, {
          displayName: name,
          photoURL: snap.get('photoURL') ?? null,
          code: codeOf(u.uid),
          isGuest: u.isAnonymous,
          avatar,
          createdAt: snap.get('createdAt') ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const p = { displayName: name, code: codeOf(u.uid), avatar };
        setProfile(p);
        cacheProfile(u.uid, p);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, user, profile, rev, ensureSignedIn, afterSignIn],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth ngoài AuthProvider');
  return v;
}

export function authErrorText(e: unknown): string {
  const code = ((e as { code?: string })?.code ?? '').replace(/^auth\//, '');
  if (code && i18n.exists(`authErrors.${code}`)) return i18n.t(`authErrors.${code}` as 'authErrors.notSignedIn');
  return (e as Error)?.message ?? i18n.t('common.errorGeneric');
}
