/**
 * Sáu profile AI. Mỗi mức có ngân sách (thời gian / số node / độ sâu), bộ tính năng tìm kiếm và
 * chính sách sai lầm riêng. Khác biệt sức mạnh được đo bằng tactical suite + đấu chéo (xem docs/AI-BENCHMARK.md).
 * Thời gian là NGÂN SÁCH TỐI ĐA cho tìm kiếm, không phải độ trễ giả.
 */
import type { SearchFeatures } from './search.js';

export type AiLevel = 'super_easy' | 'easy' | 'medium' | 'hard' | 'super_hard' | 'master';

export interface MistakePolicy {
  /** Xác suất chọn một nước hợp lệ ngẫu nhiên hoàn toàn. */
  randomMoveProb: number;
  /** Nhiễu đều ±noiseCp cộng vào điểm từng nước gốc trước khi chọn. */
  noiseCp: number;
  /** Xác suất chọn ngẫu nhiên trong các nước kém nước tốt nhất không quá blunderMarginCp. */
  blunderProb: number;
  blunderMarginCp: number;
}

export interface AiProfile {
  id: AiLevel;
  label: string;
  description: string;
  features: SearchFeatures;
  mistakes: MistakePolicy;
}

const NO_MISTAKES: MistakePolicy = { randomMoveProb: 0, noiseCp: 0, blunderProb: 0, blunderMarginCp: 0 };

export const AI_PROFILES: Record<AiLevel, AiProfile> = {
  super_easy: {
    id: 'super_easy',
    label: 'Siêu dễ',
    description: 'Gần như ngẫu nhiên, thường bỏ quân.',
    features: {
      maxDepth: 1,
      timeMs: 120,
      maxNodes: 20_000,
      useTT: false,
      ttSizeLog2: 10,
      useNullMove: false,
      useLMR: false,
      useKillers: false,
      quiescence: 'none',
      qMaxDepth: 0,
      exactRootScores: true,
    },
    mistakes: { randomMoveProb: 0.45, noiseCp: 300, blunderProb: 0, blunderMarginCp: 0 },
  },
  easy: {
    id: 'easy',
    label: 'Dễ',
    description: 'Biết giá trị quân, ăn quân cơ bản, nhìn nông.',
    features: {
      maxDepth: 2,
      timeMs: 250,
      maxNodes: 100_000,
      useTT: false,
      ttSizeLog2: 10,
      useNullMove: false,
      useLMR: false,
      useKillers: false,
      quiescence: 'captures',
      qMaxDepth: 2,
      exactRootScores: true,
    },
    mistakes: { randomMoveProb: 0.04, noiseCp: 60, blunderProb: 0.15, blunderMarginCp: 220 },
  },
  medium: {
    id: 'medium',
    label: 'Trung bình',
    description: 'Né mất quân đơn giản, tìm kiếm 3–4 lớp.',
    features: {
      maxDepth: 4,
      timeMs: 600,
      maxNodes: 600_000,
      useTT: true,
      ttSizeLog2: 18,
      useNullMove: false,
      useLMR: false,
      useKillers: true,
      quiescence: 'full',
      qMaxDepth: 8,
      exactRootScores: true,
    },
    mistakes: { randomMoveProb: 0, noiseCp: 20, blunderProb: 0.05, blunderMarginCp: 80 },
  },
  hard: {
    id: 'hard',
    label: 'Khó',
    description: 'Tìm kiếm nhiều lớp, đánh giá thế trận, không cố ý sai.',
    features: {
      maxDepth: 8,
      timeMs: 1200,
      maxNodes: 3_000_000,
      useTT: true,
      ttSizeLog2: 20,
      useNullMove: false,
      useLMR: false,
      useKillers: true,
      quiescence: 'full',
      qMaxDepth: 10,
      exactRootScores: false,
    },
    mistakes: NO_MISTAKES,
  },
  super_hard: {
    id: 'super_hard',
    label: 'Siêu khó',
    description: 'Ngân sách cao, đủ TT/quiescence/null-move/LMR.',
    features: {
      maxDepth: 16,
      timeMs: 2500,
      maxNodes: 12_000_000,
      useTT: true,
      ttSizeLog2: 21,
      useNullMove: true,
      useLMR: true,
      useKillers: true,
      quiescence: 'full',
      qMaxDepth: 12,
      exactRootScores: false,
    },
    mistakes: NO_MISTAKES,
  },
  master: {
    id: 'master',
    label: 'Bậc thầy (Master)',
    description: 'Profile mạnh nhất của engine: ngân sách lớn nhất, không có sai lầm ngẫu nhiên.',
    features: {
      maxDepth: 40,
      timeMs: 5000,
      maxNodes: 40_000_000,
      useTT: true,
      ttSizeLog2: 21,
      useNullMove: true,
      useLMR: true,
      useKillers: true,
      quiescence: 'full',
      qMaxDepth: 16,
      exactRootScores: false,
    },
    mistakes: NO_MISTAKES,
  },
};

export const AI_LEVELS: AiLevel[] = ['super_easy', 'easy', 'medium', 'hard', 'super_hard', 'master'];

export interface DeviceLimits {
  /** Trần thời gian (ms) cho thiết bị yếu. */
  maxTimeMs?: number;
  /** Trần kích thước TT (log2 số entry, mỗi entry ~14 byte). */
  maxTtSizeLog2?: number;
}

export function resolveFeatures(level: AiLevel, limits: DeviceLimits = {}): SearchFeatures {
  const f = { ...AI_PROFILES[level].features };
  if (limits.maxTimeMs !== undefined) f.timeMs = Math.min(f.timeMs, limits.maxTimeMs);
  if (limits.maxTtSizeLog2 !== undefined) f.ttSizeLog2 = Math.min(f.ttSizeLog2, limits.maxTtSizeLog2);
  return f;
}
