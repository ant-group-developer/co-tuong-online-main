/**
 * Tìm kiếm: iterative deepening + negamax alpha-beta (PVS), transposition table, quiescence,
 * sắp xếp nước (TT move, MVV-LVA, killer, history), null-move pruning và LMR (bật/tắt theo profile).
 * Không có sleep hay độ trễ giả: mọi khác biệt sức mạnh đến từ ngân sách & tính năng tìm kiếm.
 */
import type { Position } from '../position.js';
import { KING, type Move, type SideSign } from '../types.js';
import { evaluate, PIECE_VALUE } from './evaluate.js';

export const MATE = 30000;
export const MATE_BOUND = MATE - 1000;
const INF = 32000;
const MAX_PLY = 96;
const MOVES_PER_PLY = 192;
/** Điểm phạt cho bên trường chiếu khi phát hiện lặp trong cây tìm kiếm (luật xq-rules-v1 xử thua). */
const PERPETUAL_SCORE = 3000;

const FLAG_EXACT = 1;
const FLAG_LOWER = 2;
const FLAG_UPPER = 3;

export interface SearchFeatures {
  maxDepth: number;
  timeMs: number;
  maxNodes: number;
  useTT: boolean;
  ttSizeLog2: number;
  useNullMove: boolean;
  useLMR: boolean;
  useKillers: boolean;
  /** none: dừng ở độ sâu 0 bằng eval tĩnh; captures: chỉ ăn quân; full: ăn quân + thoát chiếu. */
  quiescence: 'none' | 'captures' | 'full';
  qMaxDepth: number;
  /** Tính điểm chính xác cho mọi nước gốc (cần cho chính sách sai lầm có chủ đích ở mức thấp). */
  exactRootScores: boolean;
}

export interface RootScore {
  move: Move;
  score: number;
}

export interface SearchResult {
  bestMove: Move;
  score: number;
  depth: number;
  nodes: number;
  timeMs: number;
  pv: Move[];
  rootScores: RootScore[];
  stoppedBy: 'depth' | 'time' | 'nodes' | 'mate' | 'only_move';
}

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

class StopSearch extends Error {}

export class Searcher {
  private pos!: Position;
  private f!: SearchFeatures;
  private ttMask = 0;
  private ttKey = new Uint32Array(1);
  private ttMove = new Int32Array(1);
  private ttScore = new Int32Array(1);
  private ttDepth = new Int8Array(1);
  private ttFlag = new Uint8Array(1);
  private readonly moveBuf = new Int32Array(MAX_PLY * MOVES_PER_PLY);
  private readonly scoreBuf = new Int32Array(MAX_PLY * MOVES_PER_PLY);
  private readonly killers = new Int32Array(MAX_PLY * 2);
  private readonly historyTable = new Int32Array(15 * 90);
  private nodes = 0;
  private startTime = 0;
  private deadline = 0;
  private stopReason: SearchResult['stoppedBy'] = 'depth';
  /** Hàm hủy từ bên ngoài (ví dụ cờ hủy job trong worker). */
  shouldAbort: (() => boolean) | null = null;

  private ensureTT(log2: number): void {
    const size = 1 << log2;
    if (this.ttKey.length !== size) {
      this.ttKey = new Uint32Array(size);
      this.ttMove = new Int32Array(size);
      this.ttScore = new Int32Array(size);
      this.ttDepth = new Int8Array(size);
      this.ttFlag = new Uint8Array(size);
    } else {
      this.ttFlag.fill(0);
    }
    this.ttMask = size - 1;
  }

  search(pos: Position, features: SearchFeatures): SearchResult {
    this.pos = pos;
    this.f = features;
    this.nodes = 0;
    this.startTime = now();
    this.deadline = this.startTime + features.timeMs;
    this.stopReason = 'depth';
    this.killers.fill(0);
    this.historyTable.fill(0);
    if (features.useTT) this.ensureTT(features.ttSizeLog2);

    const rootMoves = pos.legalMoves();
    const empty: SearchResult = {
      bestMove: 0,
      score: -MATE,
      depth: 0,
      nodes: 0,
      timeMs: 0,
      pv: [],
      rootScores: [],
      stoppedBy: 'depth',
    };
    if (rootMoves.length === 0) return empty;

    let rootScores: RootScore[] = rootMoves.map((m) => ({ move: m, score: 0 }));
    let best: SearchResult = {
      ...empty,
      bestMove: rootMoves[0],
      score: 0,
      rootScores: rootScores.map((r) => ({ ...r })),
    };
    if (rootMoves.length === 1 && !features.exactRootScores) {
      return { ...best, stoppedBy: 'only_move', timeMs: now() - this.startTime };
    }

    let prevScore = 0;
    for (let depth = 1; depth <= features.maxDepth; depth++) {
      let iter: { move: Move; score: number; scores: RootScore[] } | null = null;
      try {
        if (features.exactRootScores || depth < 4) {
          iter = this.searchRoot(rootScores, depth, -INF, INF);
        } else {
          // Aspiration window quanh điểm vòng trước.
          let delta = 40;
          let alpha = Math.max(-INF, prevScore - delta);
          let beta = Math.min(INF, prevScore + delta);
          for (;;) {
            const r = this.searchRoot(rootScores, depth, alpha, beta);
            if (r.score <= alpha) {
              alpha = Math.max(-INF, alpha - delta * 4);
              delta *= 4;
            } else if (r.score >= beta) {
              beta = Math.min(INF, beta + delta * 4);
              delta *= 4;
            } else {
              iter = r;
              break;
            }
            if (delta > 2000) {
              alpha = -INF;
              beta = INF;
            }
          }
        }
      } catch (e) {
        if (!(e instanceof StopSearch)) throw e;
        // Dừng giữa vòng: dùng kết quả vòng hoàn chỉnh gần nhất (an toàn).
        break;
      }
      rootScores = iter.scores;
      prevScore = iter.score;
      best = {
        bestMove: iter.move,
        score: iter.score,
        depth,
        nodes: this.nodes,
        timeMs: now() - this.startTime,
        pv: this.extractPv(iter.move, depth),
        rootScores: rootScores.map((r) => ({ ...r })),
        stoppedBy: 'depth',
      };
      // Chỉ dừng khi độ sâu danh nghĩa đã phủ tới điểm chiếu hết => không còn lời giải ngắn hơn bị bỏ sót
      // (phần mở rộng chiếu có thể làm lộ ra chiếu hết dài hơn ở độ sâu thấp).
      if (Math.abs(iter.score) >= MATE_BOUND && depth >= MATE - Math.abs(iter.score) && !features.exactRootScores) {
        best.stoppedBy = 'mate';
        break;
      }
      // Không bắt đầu vòng mới nếu khó hoàn thành trong thời gian còn lại.
      const elapsed = now() - this.startTime;
      if (elapsed > features.timeMs * 0.45) {
        best.stoppedBy = 'time';
        break;
      }
      if (this.nodes > features.maxNodes * 0.5) {
        best.stoppedBy = 'nodes';
        break;
      }
    }
    if (this.stopReason !== 'depth') best.stoppedBy = this.stopReason;
    best.nodes = this.nodes;
    best.timeMs = now() - this.startTime;
    return best;
  }

  private checkLimits(): void {
    if (this.nodes >= this.f.maxNodes) {
      this.stopReason = 'nodes';
      throw new StopSearch();
    }
    if ((this.nodes & 1023) === 0) {
      if (now() >= this.deadline) {
        this.stopReason = 'time';
        throw new StopSearch();
      }
      if (this.shouldAbort?.()) {
        this.stopReason = 'time';
        throw new StopSearch();
      }
    }
  }

  private searchRoot(
    prev: RootScore[],
    depth: number,
    alphaIn: number,
    beta: number,
  ): { move: Move; score: number; scores: RootScore[] } {
    const pos = this.pos;
    // Sắp xếp theo điểm vòng trước (ổn định).
    const order = prev.slice().sort((a, b) => b.score - a.score);
    let alpha = alphaIn;
    let bestScore = -INF;
    let bestMove = order[0].move;
    const scores: RootScore[] = [];
    const exact = this.f.exactRootScores;
    for (let i = 0; i < order.length; i++) {
      const m = order[i].move;
      pos.make(m);
      let score: number;
      try {
        if (exact) {
          score = -this.negamax(depth - 1, -INF, INF, 1, true, true);
        } else if (i === 0) {
          score = -this.negamax(depth - 1, -beta, -alpha, 1, true, true);
        } else {
          score = -this.negamax(depth - 1, -alpha - 1, -alpha, 1, true, false);
          if (score > alpha && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, 1, true, true);
        }
      } finally {
        pos.unmake();
      }
      scores.push({ move: m, score });
      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
      }
      if (!exact && score > alpha) alpha = score;
      if (!exact && alpha >= beta) {
        // fail-high: phần còn lại giữ điểm cũ thấp hơn để thứ tự hợp lý
        for (let j = i + 1; j < order.length; j++) scores.push({ move: order[j].move, score: -INF + 1 });
        break;
      }
    }
    if (this.f.useTT) this.ttStore(depth, bestScore, FLAG_EXACT, bestMove, 0);
    return { move: bestMove, score: bestScore, scores };
  }

  private negamax(depthIn: number, alphaIn: number, betaIn: number, ply: number, allowNull: boolean, pvNode: boolean): number {
    const pos = this.pos;
    this.nodes++;
    this.checkLimits();
    let alpha = alphaIn;
    let beta = betaIn;
    let depth = depthIn;

    // Lặp lại trong cây (2 lần) => hòa, hoặc xử thua bên trường chiếu theo luật v1.
    if (pos.halfmove >= 4) {
      const rep = pos.detectRepetition(2);
      if (rep) {
        const stm = pos.side;
        if (rep.redPerpetual !== rep.blackPerpetual) {
          const loser: SideSign = rep.redPerpetual ? 1 : -1;
          return loser === stm ? -PERPETUAL_SCORE : PERPETUAL_SCORE;
        }
        return 0;
      }
    }
    if (pos.halfmove >= 120) return 0;
    if (ply >= MAX_PLY - 2) return evaluate(pos);

    // Mate distance pruning
    alpha = Math.max(alpha, -MATE + ply);
    beta = Math.min(beta, MATE - ply - 1);
    if (alpha >= beta) return alpha;

    const inCheck = pos.inCheck();
    pos.setCheckFlag(inCheck);
    if (inCheck) depth++;

    if (depth <= 0) return this.quiesce(alpha, beta, ply, 0);

    // Transposition table
    let ttMove = 0;
    if (this.f.useTT) {
      const idx = pos.hashLo & this.ttMask;
      if (this.ttFlag[idx] !== 0 && this.ttKey[idx] === pos.hashHi >>> 0) {
        ttMove = this.ttMove[idx];
        if (this.ttDepth[idx] >= depth && !pvNode) {
          let s = this.ttScore[idx];
          if (s > MATE_BOUND) s -= ply;
          else if (s < -MATE_BOUND) s += ply;
          const fl = this.ttFlag[idx];
          if (fl === FLAG_EXACT) return s;
          if (fl === FLAG_LOWER && s >= beta) return s;
          if (fl === FLAG_UPPER && s <= alpha) return s;
        }
      }
    }

    // Null-move pruning
    if (
      this.f.useNullMove &&
      allowNull &&
      !pvNode &&
      !inCheck &&
      depth >= 3 &&
      this.hasPieces(pos.side) &&
      evaluate(pos) >= beta
    ) {
      const R = depth >= 6 ? 3 : 2;
      pos.makeNull();
      let s: number;
      try {
        s = -this.negamax(depth - 1 - R, -beta, -beta + 1, ply + 1, false, false);
      } finally {
        pos.unmakeNull();
      }
      if (s >= beta && s < MATE_BOUND) return beta;
    }

    const base = ply * MOVES_PER_PLY;
    const end = pos.genMoves(this.moveBuf, base, false);
    this.scoreMoves(base, end, ttMove, ply);

    const mover = pos.side;
    let legal = 0;
    let bestScore = -INF;
    let bestMove = 0;
    const origAlpha = alpha;
    for (let i = base; i < end; i++) {
      const m = this.pickNext(i, end);
      const cap = pos.make(m);
      if (pos.inCheck(mover)) {
        pos.unmake();
        continue;
      }
      legal++;
      let score: number;
      try {
        if (legal === 1) {
          score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true, pvNode);
        } else {
          let reduction = 0;
          if (
            this.f.useLMR &&
            depth >= 3 &&
            legal > 3 &&
            cap === 0 &&
            !inCheck &&
            m !== this.killers[ply * 2] &&
            m !== this.killers[ply * 2 + 1] &&
            !pos.inCheck()
          ) {
            reduction = legal > 10 && depth >= 5 ? 2 : 1;
          }
          score = -this.negamax(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true, false);
          if (score > alpha && reduction > 0) score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true, false);
          if (score > alpha && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true, true);
        }
      } finally {
        pos.unmake();
      }
      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (score >= beta) {
            if (cap === 0) this.recordQuiet(m, depth, ply);
            break;
          }
        }
      }
    }

    if (legal === 0) return -MATE + ply; // chiếu hết hoặc hết nước => thua

    if (this.f.useTT) {
      const flag = bestScore >= beta ? FLAG_LOWER : bestScore > origAlpha ? FLAG_EXACT : FLAG_UPPER;
      this.ttStore(depth, bestScore, flag, bestMove, ply);
    }
    return bestScore;
  }

  private quiesce(alphaIn: number, beta: number, ply: number, qply: number): number {
    const pos = this.pos;
    this.nodes++;
    this.checkLimits();
    let alpha = alphaIn;
    const mode = this.f.quiescence;
    if (mode === 'none' || ply >= MAX_PLY - 2) return evaluate(pos);

    const inCheck = mode === 'full' && qply < 6 ? pos.inCheck() : false;
    if (inCheck) pos.setCheckFlag(true);
    let standPat = -INF;
    if (!inCheck) {
      standPat = evaluate(pos);
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      if (qply >= this.f.qMaxDepth) return standPat;
    }

    const base = ply * MOVES_PER_PLY;
    const end = pos.genMoves(this.moveBuf, base, !inCheck);
    this.scoreMoves(base, end, 0, ply);
    const mover = pos.side;
    let best = inCheck ? -INF : standPat;
    let legal = 0;
    for (let i = base; i < end; i++) {
      const m = this.pickNext(i, end);
      const victim = Math.abs(pos.board[m >> 7]);
      // Delta pruning: ăn quân không thể kéo điểm lên tới alpha.
      if (!inCheck && victim !== KING && standPat + PIECE_VALUE[victim] + 150 < alpha) continue;
      pos.make(m);
      if (pos.inCheck(mover)) {
        pos.unmake();
        continue;
      }
      legal++;
      let score: number;
      try {
        score = -this.quiesce(-beta, -alpha, ply + 1, qply + 1);
      } finally {
        pos.unmake();
      }
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (score >= beta) break;
        }
      }
    }
    if (inCheck && legal === 0) return -MATE + ply;
    return best;
  }

  private hasPieces(side: SideSign): boolean {
    const c = this.pos.counts;
    return c[7 + side * 5] + c[7 + side * 4] + c[7 + side * 6] > 0;
  }

  private scoreMoves(base: number, end: number, ttMove: number, ply: number): void {
    const b = this.pos.board;
    const k1 = this.f.useKillers ? this.killers[ply * 2] : 0;
    const k2 = this.f.useKillers ? this.killers[ply * 2 + 1] : 0;
    for (let i = base; i < end; i++) {
      const m = this.moveBuf[i];
      const from = m & 127;
      const to = m >> 7;
      const victim = b[to];
      let s: number;
      if (m === ttMove) s = 10_000_000;
      else if (victim !== 0) s = 1_000_000 + PIECE_VALUE[Math.abs(victim)] * 16 - (PIECE_VALUE[Math.abs(b[from])] >> 4);
      else if (m === k1) s = 900_000;
      else if (m === k2) s = 800_000;
      else s = this.historyTable[(b[from] + 7) * 90 + to];
      this.scoreBuf[i] = s;
    }
  }

  /** Selection sort từng bước: đưa nước điểm cao nhất còn lại về vị trí i. */
  private pickNext(i: number, end: number): Move {
    let bi = i;
    let bs = this.scoreBuf[i];
    for (let j = i + 1; j < end; j++) {
      if (this.scoreBuf[j] > bs) {
        bs = this.scoreBuf[j];
        bi = j;
      }
    }
    if (bi !== i) {
      const tm = this.moveBuf[i];
      this.moveBuf[i] = this.moveBuf[bi];
      this.moveBuf[bi] = tm;
      const ts = this.scoreBuf[i];
      this.scoreBuf[i] = this.scoreBuf[bi];
      this.scoreBuf[bi] = ts;
    }
    return this.moveBuf[i];
  }

  private recordQuiet(m: Move, depth: number, ply: number): void {
    if (this.f.useKillers && this.killers[ply * 2] !== m) {
      this.killers[ply * 2 + 1] = this.killers[ply * 2];
      this.killers[ply * 2] = m;
    }
    const p = this.pos.board[m & 127];
    const idx = (p + 7) * 90 + (m >> 7);
    this.historyTable[idx] += depth * depth;
    if (this.historyTable[idx] > 700_000) {
      for (let i = 0; i < this.historyTable.length; i++) this.historyTable[i] >>= 1;
    }
  }

  private ttStore(depth: number, scoreIn: number, flag: number, move: Move, ply: number): void {
    const pos = this.pos;
    const idx = pos.hashLo & this.ttMask;
    // Thay thế khi sâu hơn hoặc khác vị trí.
    if (this.ttFlag[idx] !== 0 && this.ttKey[idx] === pos.hashHi >>> 0 && this.ttDepth[idx] > depth && flag !== FLAG_EXACT) return;
    let s = scoreIn;
    if (s > MATE_BOUND) s += ply;
    else if (s < -MATE_BOUND) s -= ply;
    this.ttKey[idx] = pos.hashHi >>> 0;
    this.ttMove[idx] = move;
    this.ttScore[idx] = s;
    this.ttDepth[idx] = Math.min(depth, 127);
    this.ttFlag[idx] = flag;
  }

  private extractPv(first: Move, depth: number): Move[] {
    const pv: Move[] = [first];
    if (!this.f.useTT) return pv;
    const pos = this.pos;
    let made = 0;
    pos.make(first);
    made++;
    for (let i = 1; i < depth; i++) {
      const idx = pos.hashLo & this.ttMask;
      if (this.ttFlag[idx] === 0 || this.ttKey[idx] !== pos.hashHi >>> 0) break;
      const m = this.ttMove[idx];
      if (!m || !pos.isLegal(m)) break;
      pv.push(m);
      pos.make(m);
      made++;
    }
    while (made-- > 0) pos.unmake();
    return pv;
  }
}
