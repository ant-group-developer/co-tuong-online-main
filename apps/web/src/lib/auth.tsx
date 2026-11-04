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
  configured: boolean;
  ensureSignedIn: () => Promise<User>;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  saveDisplayName: (name: string) => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function cleanName(s: string): string {
  return s.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 24);
}

export function codeOf(uid: string): string {
  return uid.slice(0, 6).toUpperCase();
}

export function guestNameOf(uid: string): string {
  return `Khách ${codeOf(uid)}`;
}

function providerOf(u: User | null): string {
  if (!u) return '';
  if (u.isAnonymous) return 'anonymous';
  return u.providerData[0]?.providerId ?? 'password';
}

interface Profile {
  displayName: string;
  code: string;
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
    const wasDefault = cur === guestNameOf(user.uid) || cur.length < 2;
    const name = !isGuest && wasDefault && realName.length >= 2 ? realName : cur.length >= 2 ? cur : guestNameOf(user.uid);
    const photo = !isGuest && user.photoURL?.startsWith('https://') ? user.photoURL : (snap.get('photoURL') ?? null);
    if (snap.get('code') !== code || snap.get('isGuest') !== isGuest || name !== cur || photo !== (snap.get('photoURL') ?? null)) {
      await setDoc(ref, { displayName: name, photoURL: photo, code, isGuest, createdAt: snap.get('createdAt'), updatedAt: serverTimestamp() });
    }
    return { displayName: name, code };
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
  const [profile, setProfile] = useState<Profile>({ displayName: '', code: '' });
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
    try {
      setProfile(await ensureProfile(u, preferred));
    } catch {
      setProfile({ displayName: u.isAnonymous ? guestNameOf(u.uid) : (u.displayName ?? 'Kỳ thủ'), code: codeOf(u.uid) });
    }
  }, []);

  const ensureSignedIn = useCallback(async () => {
    const { auth } = fb();
    if (auth.currentUser) return auth.currentUser;
    // Gộp nhiều lời gọi đồng thời thành một lần tạo khách.
    anonPending.current ??= signInAnonymously(auth)
      .then((c) => c.user)
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
        if (!u) throw new Error('Chưa đăng nhập');
        const n = cleanName(name);
        if (n.length < 2) throw new Error('Tên cần từ 2 đến 24 ký tự');
        const ref = doc(fb().fs, 'publicProfiles', u.uid);
        const snap = await getDoc(ref);
        await setDoc(ref, {
          displayName: n,
          photoURL: snap.get('photoURL') ?? null,
          code: codeOf(u.uid),
          isGuest: u.isAnonymous,
          createdAt: snap.get('createdAt') ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setProfile({ displayName: n, code: codeOf(u.uid) });
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

export function authErrorVi(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng',
    'auth/wrong-password': 'Mật khẩu không đúng',
    'auth/user-not-found': 'Không tìm thấy tài khoản',
    'auth/email-already-in-use': 'Email đã có tài khoản – hãy chọn "Đăng nhập" thay vì tạo mới',
    'auth/credential-already-in-use': 'Tài khoản này đã được dùng ở nơi khác',
    'auth/provider-already-linked': 'Tài khoản đã được liên kết',
    'auth/weak-password': 'Mật khẩu cần ít nhất 6 ký tự',
    'auth/invalid-email': 'Email không hợp lệ',
    'auth/popup-closed-by-user': 'Bạn đã đóng cửa sổ đăng nhập',
    'auth/popup-blocked': 'Trình duyệt chặn cửa sổ đăng nhập, hãy cho phép popup',
    'auth/network-request-failed': 'Lỗi mạng, hãy thử lại',
    'auth/operation-not-allowed': 'Phương thức đăng nhập này chưa được bật trong Firebase Console',
    'auth/admin-restricted-operation': 'Đăng nhập khách chưa được bật trong Firebase Console',
  };
  return map[code] ?? (e as Error)?.message ?? 'Đã có lỗi xảy ra';
}
