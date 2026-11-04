/**
 * Dữ liệu hiển thị của 6 mức máy + thành tích của người chơi với từng mức (lưu trên trình duyệt).
 * Chữ (tên, "Dành cho", "Máy chơi thế nào") nằm trong i18n: levels.<mức>.{name,for,play,hint}.
 * Số liệu lấy thẳng từ cấu hình engine (packages/engine/src/ai/profiles.ts) để mô tả luôn khớp với máy thật.
 */
import { AI_LEVELS, AI_PROFILES, type AiLevel } from '@xq/engine/ai';
import i18n, { fmtNumber } from '../i18n';

export interface LevelInfo {
  level: AiLevel;
  /** Độ mạnh 1–6 */
  stars: number;
  /** Thời gian nghĩ tối đa mỗi nước (giây, trên máy tính bàn) */
  seconds: number;
}

export const LEVEL_INFO: LevelInfo[] = AI_LEVELS.map((level, i) => ({
  level,
  stars: i + 1,
  seconds: AI_PROFILES[level].features.timeMs / 1000,
}));

export const infoOf = (level: AiLevel): LevelInfo => LEVEL_INFO.find((l) => l.level === level)!;

/** Tên mức theo ngôn ngữ hiện tại. */
export const levelName = (level: AiLevel): string => i18n.t(`levels.${level}.name`);

export const thinkText = (level: AiLevel): string => i18n.t('levels.think', { seconds: fmtNumber(infoOf(level).seconds, 2) });

export function nextLevel(level: AiLevel, dir: 1 | -1): AiLevel | null {
  const i = AI_LEVELS.indexOf(level) + dir;
  return i >= 0 && i < AI_LEVELS.length ? AI_LEVELS[i] : null;
}

export function isAiLevel(v: unknown): v is AiLevel {
  return typeof v === 'string' && (AI_LEVELS as string[]).includes(v);
}

// ---------------- Thành tích theo mức ----------------

export interface Record3 {
  w: number;
  d: number;
  l: number;
}
export type Records = Partial<Record<AiLevel, Record3>>;

const REC_KEY = 'xq.ai.records.v1';
const DONE_KEY = 'xq.ai.recorded.v1';

export function loadRecords(): Records {
  try {
    return (JSON.parse(localStorage.getItem(REC_KEY) ?? '{}') as Records) ?? {};
  } catch {
    return {};
  }
}

/** Ghi kết quả một ván (mỗi gameId chỉ ghi một lần). Trả về thành tích mới. */
export function recordResult(gameId: string, level: AiLevel, outcome: 'w' | 'd' | 'l'): Records {
  const recs = loadRecords();
  try {
    const done = new Set<string>(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[]);
    if (done.has(gameId)) return recs;
    const r = recs[level] ?? { w: 0, d: 0, l: 0 };
    r[outcome]++;
    recs[level] = r;
    localStorage.setItem(REC_KEY, JSON.stringify(recs));
    localStorage.setItem(DONE_KEY, JSON.stringify([...done, gameId].slice(-200)));
  } catch {
    /* localStorage bị chặn: bỏ qua */
  }
  return recs;
}

export function newGameId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
