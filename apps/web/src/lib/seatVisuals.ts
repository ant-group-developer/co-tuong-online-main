/**
 * Dữ liệu cho bàn 3D khi chơi online: nhân vật của từng người (Firestore publicProfiles/{uid}.avatar)
 * và biểu cảm vừa gửi (RTDB roomEmotes/{roomId}/{uid}; chỉ người đang ngồi ghế mới ghi được, tối đa 1 lần / 1,5 giây).
 */
import { ref, serverTimestamp, set } from 'firebase/database';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { DEFAULT_AVATAR, isAvatarId, isEmoteId, type AvatarId, type EmoteId } from './avatars';
import { fb } from './firebase';
import { useRtdb } from './rtdb';

const avatarCache = new Map<string, AvatarId>();

/** Nhân vật của một người chơi (cập nhật khi họ đổi). */
export function useAvatarOf(uid: string | null | undefined): AvatarId {
  const [avatar, setAvatar] = useState<AvatarId>(() => (uid && avatarCache.get(uid)) || DEFAULT_AVATAR);
  useEffect(() => {
    if (!uid) return;
    setAvatar(avatarCache.get(uid) ?? DEFAULT_AVATAR);
    return onSnapshot(
      doc(fb().fs, 'publicProfiles', uid),
      (snap) => {
        const v = snap.get('avatar') as unknown;
        const a = isAvatarId(v) ? v : DEFAULT_AVATAR;
        avatarCache.set(uid, a);
        setAvatar(a);
      },
      () => undefined,
    );
  }, [uid]);
  return avatar;
}

export interface EmoteEvent {
  id: EmoteId;
  at: number;
}

/** Biểu cảm gần nhất của mỗi người trong phòng (uid -> sự kiện). Bỏ qua biểu cảm cũ hơn 10 giây. */
export function useRoomEmotes(roomId: string | null, offsetMs: number): Record<string, EmoteEvent> {
  const live = useRtdb<Record<string, { e?: unknown; at?: unknown }>>(roomId ? `roomEmotes/${roomId}` : null);
  const out: Record<string, EmoteEvent> = {};
  const now = Date.now() + offsetMs;
  for (const [uid, v] of Object.entries(live.data ?? {})) {
    if (v && isEmoteId(v.e) && typeof v.at === 'number' && now - v.at < 10_000) out[uid] = { id: v.e, at: v.at };
  }
  return out;
}

export async function sendEmote(roomId: string, uid: string, e: EmoteId): Promise<void> {
  await set(ref(fb().db, `roomEmotes/${roomId}/${uid}`), { e, at: serverTimestamp() });
}
