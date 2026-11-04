import {
  onDisconnect,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
  type DataSnapshot,
} from 'firebase/database';
import { useEffect, useRef, useState } from 'react';
import { fb } from './firebase';

export interface Live<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Theo dõi một đường dẫn RTDB. `path = null` để tạm dừng. */
export function useRtdb<T>(path: string | null): Live<T> {
  const [state, setState] = useState<Live<T>>({ data: null, loading: !!path, error: null });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const unsub = onValue(
      ref(fb().db, path),
      (snap: DataSnapshot) => setState({ data: snap.val() as T | null, loading: false, error: null }),
      (err) => setState({ data: null, loading: false, error: /permission/i.test(err.message) ? 'permission_denied' : err.message }),
    );
    return unsub;
  }, [path]);
  return state;
}

/** Trạng thái kết nối RTDB (.info/connected) và độ lệch đồng hồ server. */
export function useConnection(): { connected: boolean; offsetMs: number } {
  const [connected, setConnected] = useState(true);
  const [offsetMs, setOffset] = useState(0);
  useEffect(() => {
    const db = fb().db;
    const a = onValue(ref(db, '.info/connected'), (s) => setConnected(!!s.val()));
    const b = onValue(ref(db, '.info/serverTimeOffset'), (s) => setOffset(Number(s.val()) || 0));
    return () => {
      a();
      b();
    };
  }, []);
  return { connected, offsetMs };
}

function connectionId(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Đăng ký người xem/người chơi đang ở phòng theo từng kết nối.
 * Thứ tự quan trọng: đăng ký onDisconnect TRƯỚC khi ghi "online", và làm lại mỗi lần kết nối lại.
 */
export function useRoomPresence(roomId: string | null, uid: string | null, enabled: boolean): void {
  const connId = useRef(connectionId());
  useEffect(() => {
    if (!roomId || !uid || !enabled) return;
    const db = fb().db;
    const viewerRef = ref(db, `roomViewers/${roomId}/${uid}/${connId.current}`);
    const seenRef = ref(db, `roomLastSeen/${roomId}/${uid}`);
    const presRef = ref(db, `presence/${uid}/${connId.current}`);
    const unsub = onValue(ref(db, '.info/connected'), async (snap) => {
      if (!snap.val()) return;
      try {
        await onDisconnect(viewerRef).remove();
        await onDisconnect(seenRef).set(serverTimestamp());
        await onDisconnect(presRef).remove();
        await set(viewerRef, { at: serverTimestamp() });
        await set(seenRef, serverTimestamp());
        await set(presRef, { at: serverTimestamp() });
      } catch {
        /* không có quyền (phòng riêng tư chưa được mời) – bỏ qua */
      }
    });
    return () => {
      unsub();
      void onDisconnect(viewerRef).cancel().catch(() => undefined);
      void remove(viewerRef).catch(() => undefined);
      void set(seenRef, serverTimestamp()).catch(() => undefined);
      void onDisconnect(presRef).cancel().catch(() => undefined);
      void remove(presRef).catch(() => undefined);
    };
  }, [roomId, uid, enabled]);
}
