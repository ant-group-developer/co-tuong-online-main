import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fb, firebaseConfigured } from './firebase';

export interface AuthState {
  ready: boolean;
  user: User | null;
  /** Tên hiển thị công khai (publicProfiles). */
  displayName: string;
  isAnonymous: boolean;
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

async function ensureProfile(user: User, preferred?: string): Promise<string> {
  const { fs } = fb();
  const ref = doc(fs, 'publicProfiles', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return String(snap.get('displayName') ?? '');
  let name = cleanName(preferred || user.displayName || user.email?.split('@')[0] || '');
  if (name.length < 2) name = user.isAnonymous ? `Khách ${user.uid.slice(0, 4)}` : `Kỳ thủ ${user.uid.slice(0, 4)}`;
  await setDoc(ref, {
    displayName: name,
    photoURL: user.photoURL && user.photoURL.startsWith('https://') ? user.photoURL : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return name;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!firebaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    if (!firebaseConfigured) return;
    const { auth } = fb();
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          setDisplayName(await ensureProfile(u));
        } catch {
          setDisplayName(u.displayName ?? 'Kỳ thủ');
        }
      } else {
        setDisplayName('');
      }
      setReady(true);
    });
  }, []);

  const ensureSignedIn = useCallback(async () => {
    const { auth } = fb();
    if (auth.currentUser) return auth.currentUser;
    const cred = await signInAnonymously(auth);
    return cred.user;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      user,
      displayName,
      isAnonymous: !!user?.isAnonymous,
      configured: firebaseConfigured,
      ensureSignedIn,
      signInGoogle: async () => {
        const { auth } = fb();
        const cred = await signInWithPopup(auth, new GoogleAuthProvider());
        setDisplayName(await ensureProfile(cred.user));
      },
      signInEmail: async (email, password) => {
        const { auth } = fb();
        await signInWithEmailAndPassword(auth, email, password);
      },
      signUpEmail: async (email, password, name) => {
        const { auth } = fb();
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const n = cleanName(name);
        if (n.length >= 2) await updateProfile(cred.user, { displayName: n });
        setDisplayName(await ensureProfile(cred.user, n));
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
          createdAt: snap.get('createdAt') ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setDisplayName(n);
      },
    }),
    [ready, user, displayName, ensureSignedIn],
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
    'auth/email-already-in-use': 'Email đã được sử dụng',
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
