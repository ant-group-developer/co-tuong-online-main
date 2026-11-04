/// <reference lib="webworker" />
/**
 * Web Worker chạy tìm kiếm AI – không chặn luồng UI.
 * Hủy job = main thread terminate() worker (tìm kiếm đồng bộ không nhận message giữa chừng).
 */
import { replayMoves } from '@xq/engine';
import { Searcher, chooseMove, type AiLevel, type DeviceLimits } from '@xq/engine/ai';

export interface AiRequest {
  type: 'search';
  jobId: number;
  positionVersion: number;
  startFen: string;
  moves: string[];
  level: AiLevel;
  limits?: DeviceLimits;
  seed: number;
}

export type AiResponse =
  | {
      type: 'result';
      jobId: number;
      positionVersion: number;
      move: string | null;
      score: number;
      depth: number;
      nodes: number;
      timeMs: number;
      policy: string;
    }
  | { type: 'error'; jobId: number; positionVersion: number; message: string };

const searcher = new Searcher();
const FILES = 'abcdefghi';
const sq = (s: number) => FILES[s % 9] + String(9 - Math.floor(s / 9));

self.onmessage = (ev: MessageEvent<AiRequest>) => {
  const req = ev.data;
  if (req?.type !== 'search') return;
  try {
    const game = replayMoves(req.startFen, req.moves.join(' '));
    if (game.status.over) {
      const msg: AiResponse = { type: 'result', jobId: req.jobId, positionVersion: req.positionVersion, move: null, score: 0, depth: 0, nodes: 0, timeMs: 0, policy: 'none' };
      self.postMessage(msg);
      return;
    }
    const d = chooseMove(game.position, req.level, { seed: req.seed, limits: req.limits, searcher });
    const move = d.move ? sq(d.move & 127) + sq(d.move >> 7) : null;
    const msg: AiResponse = {
      type: 'result',
      jobId: req.jobId,
      positionVersion: req.positionVersion,
      move,
      score: d.search.score,
      depth: d.search.depth,
      nodes: d.search.nodes,
      timeMs: Math.round(d.search.timeMs),
      policy: d.policy,
    };
    self.postMessage(msg);
  } catch (e) {
    const msg: AiResponse = { type: 'error', jobId: req.jobId, positionVersion: req.positionVersion, message: String((e as Error)?.message ?? e) };
    self.postMessage(msg);
  }
};
