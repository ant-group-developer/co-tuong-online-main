/**
 * API AI: chọn nước cho một vị trí theo level. Chạy được trong Web Worker và Node (benchmark/test).
 */
import { replayMoves } from '../game.js';
import type { Position } from '../position.js';
import type { Move } from '../types.js';
import { AI_PROFILES, resolveFeatures, type AiLevel, type DeviceLimits } from './profiles.js';
import { MATE_BOUND as MB, Searcher, type SearchResult } from './search.js';

export * from './profiles.js';
export { Searcher, MATE, MATE_BOUND, type SearchFeatures, type SearchResult, type RootScore } from './search.js';
export { evaluate } from './evaluate.js';

export interface ChooseOptions {
  /** Seed cho chính sách sai lầm (tái lập được trong test/benchmark). */
  seed?: number;
  limits?: DeviceLimits;
  shouldAbort?: () => boolean;
  /** Dùng lại Searcher (giữ bộ nhớ TT giữa các nước). */
  searcher?: Searcher;
}

export interface AiDecision {
  move: Move;
  policy: 'search' | 'random' | 'noise' | 'blunder';
  search: SearchResult;
}

function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a ^= a << 13;
    a >>>= 0;
    a ^= a >>> 17;
    a ^= a << 5;
    a >>>= 0;
    return a / 4294967296;
  };
}

export function chooseMove(pos: Position, level: AiLevel, opts: ChooseOptions = {}): AiDecision {
  const profile = AI_PROFILES[level];
  const features = resolveFeatures(level, opts.limits);
  const searcher = opts.searcher ?? new Searcher();
  searcher.shouldAbort = opts.shouldAbort ?? null;
  const result = searcher.search(pos, features);
  if (!result.bestMove) return { move: 0, policy: 'search', search: result };

  const rand = rng(opts.seed ?? (Date.now() ^ (Math.random() * 0xffffffff)));
  const mk = profile.mistakes;
  const scores = result.rootScores;

  if (mk.randomMoveProb > 0 && rand() < mk.randomMoveProb) {
    const pick = scores[Math.floor(rand() * scores.length)];
    return { move: pick.move, policy: 'random', search: result };
  }
  if (mk.blunderProb > 0 && rand() < mk.blunderProb) {
    const top = Math.max(...scores.map((s) => s.score));
    const near = top >= MB ? [] : scores.filter((s) => s.score >= top - mk.blunderMarginCp);
    if (near.length > 1) {
      const pick = near[Math.floor(rand() * near.length)];
      return { move: pick.move, policy: 'blunder', search: result };
    }
  }
  if (mk.noiseCp > 0) {
    let best = scores[0];
    let bestVal = -Infinity;
    for (const s of scores) {
      // Không làm nhiễu điểm chiếu hết: nhiễu chỉ mô phỏng đánh giá thế trận kém chính xác.
      const v = Math.abs(s.score) >= MB ? s.score : s.score + (rand() * 2 - 1) * mk.noiseCp;
      if (v > bestVal) {
        bestVal = v;
        best = s;
      }
    }
    return { move: best.move, policy: 'noise', search: result };
  }
  return { move: result.bestMove, policy: 'search', search: result };
}

/** Tiện ích: dựng vị trí (kèm lịch sử để phát hiện lặp) từ FEN + chuỗi nước rồi chọn nước. */
export function chooseMoveFromHistory(startFen: string, moves: string[], level: AiLevel, opts: ChooseOptions = {}): AiDecision {
  const game = replayMoves(startFen, moves.join(' '));
  if (game.status.over) throw new Error('Ván đã kết thúc, AI không đi tiếp');
  return chooseMove(game.position, level, opts);
}
