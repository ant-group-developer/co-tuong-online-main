/**
 * Nhân vật 3D, biểu cảm và các tùy chọn hiển thị (2D/3D, góc camera, hướng chữ quân).
 * File này không import three.js để bundle chính không phải tải thư viện 3D.
 */
import type { AiLevel } from '@xq/engine/ai';
import { useCallback, useEffect, useState } from 'react';

export const AVATAR_IDS = ['thusinh', 'tieuthu', 'laosu', 'tuongquan', 'hiepnu', 'daosi', 'antstaff', 'hust', 'ptit'] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];
export const DEFAULT_AVATAR: AvatarId = 'thusinh';

export type Mood = 'idle' | 'thinking' | 'happy' | 'sad' | 'surprised' | 'wave';
/** Biểu cảm người chơi gửi được (khớp với RTDB rules `roomEmotes`). */
export const EMOTES = ['wave', 'happy', 'thinking'] as const;
export type EmoteId = (typeof EMOTES)[number];

export function isAvatarId(v: unknown): v is AvatarId {
  return typeof v === 'string' && (AVATAR_IDS as readonly string[]).includes(v);
}
export function isEmoteId(v: unknown): v is EmoteId {
  return typeof v === 'string' && (EMOTES as readonly string[]).includes(v);
}

/** Màu đại diện (thẻ chọn nhân vật, avatar tròn) – khớp màu áo/da/tóc của mô hình 3D. */
export const AVATAR_SWATCH: Record<AvatarId, { robe: string; band: string; skin: string; hair: string }> = {
  thusinh: { robe: '#e2e3da', band: '#2f4a6b', skin: '#efcfae', hair: '#15100d' },
  tieuthu: { robe: '#d9928d', band: '#f1e2c4', skin: '#f4d8c0', hair: '#120d0b' },
  laosu: { robe: '#8a7558', band: '#3c3227', skin: '#e2bc98', hair: '#eeebe4' },
  tuongquan: { robe: '#7a1f1c', band: '#8c6d3a', skin: '#d8a982', hair: '#120d0a' },
  hiepnu: { robe: '#293c3f', band: '#8f2b25', skin: '#f0cdb0', hair: '#110c0a' },
  daosi: { robe: '#5d7386', band: '#e8e2d4', skin: '#e6c19c', hair: '#1a1410' },
  antstaff: { robe: '#f6f7f9', band: '#1f4fb0', skin: '#f0d2bb', hair: '#14100e' },
  hust: { robe: '#b3161c', band: '#ffffff', skin: '#e9c6a6', hair: '#15110e' },
  ptit: { robe: '#e63b1f', band: '#f7f6f2', skin: '#f3d6c2', hair: '#15100d' },
};

/** Mỗi mức máy là một nhân vật riêng. */
export const AI_AVATAR: Record<AiLevel, AvatarId> = {
  super_easy: 'ptit',
  easy: 'hust',
  medium: 'tieuthu',
  hard: 'daosi',
  super_hard: 'tuongquan',
  master: 'laosu',
};

/** Hình ảnh một ghế trên bàn 3D. */
export interface SeatVisual {
  avatar: AvatarId;
  /** Trạng thái kéo dài: đang nghĩ, thắng (vui), thua (buồn)… */
  mood?: Mood;
  /** Biểu cảm ngắn; đổi `at` để phát lại. */
  emote?: { id: Mood; at: number } | null;
}

/* ---------------- tùy chọn lưu trên trình duyệt ---------------- */
export type ViewMode = '2d' | '3d';
export type CamPreset = 'third' | 'seat' | 'top';
export type GlyphFacing = 'owner' | 'viewer';

const listeners = new Map<string, Set<(v: string) => void>>();

function readPref<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  try {
    const v = localStorage.getItem(key);
    return v && (valid as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Tùy chọn dùng chung giữa các component (đổi ở đâu cũng cập nhật mọi nơi đang dùng). */
function usePref<T extends string>(key: string, fallback: T, valid: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback, valid));
  useEffect(() => {
    const set = listeners.get(key) ?? new Set();
    const fn = (v: string) => setValue(v as T);
    set.add(fn);
    listeners.set(key, set);
    return () => {
      set.delete(fn);
    };
  }, [key]);
  const update = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(key, v);
      } catch {
        /* bỏ qua */
      }
      for (const fn of listeners.get(key) ?? []) fn(v);
    },
    [key],
  );
  return [value, update];
}

export const useViewMode = () => usePref<ViewMode>('xq.view.v1', '2d', ['2d', '3d']);
export const useCamPreset = () => usePref<CamPreset>('xq.cam3d.v1', 'third', ['third', 'seat', 'top']);
export const useGlyphFacing = () => usePref<GlyphFacing>('xq.glyph3d.v2', 'viewer', ['owner', 'viewer']);
