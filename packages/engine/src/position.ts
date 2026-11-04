/**
 * Position: trạng thái bàn cờ có make/unmake, Zobrist hash 64-bit (2 × 32-bit), lịch sử để phát hiện lặp.
 * Dùng chung cho luật (Game), AI (search) và server (Cloud Functions).
 */
import { PST } from './pst.js';
import {
  ADVISOR_MOVES,
  ELEPHANT_MOVES,
  HORSE_ATTACKERS,
  HORSE_MOVES,
  KING_MOVES,
  PAWN_ATTACKERS,
  PAWN_MOVES,
  RAYS,
} from './tables.js';
import {
  ADVISOR,
  CANNON,
  ELEPHANT,
  HORSE,
  KING,
  PAWN,
  ROOK,
  SQUARES,
  type Move,
  type SideSign,
} from './types.js';

export const moveFrom = (m: Move): number => m & 127;
export const moveTo = (m: Move): number => m >> 7;
export const makeMove = (from: number, to: number): Move => from | (to << 7);

// ---- Zobrist (PRNG có seed cố định => hash ổn định giữa client/server/phiên bản) ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
const rng = mulberry32(0x58514e47); // "XQNG"
export const Z_LO = new Uint32Array(15 * 90);
export const Z_HI = new Uint32Array(15 * 90);
for (let i = 0; i < 15 * 90; i++) {
  Z_LO[i] = rng();
  Z_HI[i] = rng();
}
export const Z_SIDE_LO = rng();
export const Z_SIDE_HI = rng();

const MAX_HISTORY = 4096;

export class Position {
  readonly board = new Int8Array(SQUARES);
  side: SideSign = 1;
  /** kings[0] = ô tướng Đỏ, kings[1] = ô tướng Đen (-1 nếu không có). */
  readonly kings = [-1, -1];
  hashLo = 0;
  hashHi = 0;
  /** Số nửa nước kể từ lần ăn quân gần nhất. */
  halfmove = 0;
  fullmove = 1;
  /** Điểm material + PST theo góc nhìn Đỏ, cập nhật tăng dần. */
  pst = 0;
  /** Số lượng quân theo chỉ số (piece + 7). */
  readonly counts = new Int8Array(15);

  // Lịch sử: chỉ số k ứng với vị trí sau k nửa nước kể từ gốc của Position.
  histLen = 0;
  readonly histLo = new Uint32Array(MAX_HISTORY);
  readonly histHi = new Uint32Array(MAX_HISTORY);
  /** 1: bên đến lượt ở vị trí k đang bị chiếu, 0: không, -1: chưa biết. */
  readonly histCheck = new Int8Array(MAX_HISTORY);
  private readonly capStack = new Int8Array(MAX_HISTORY);
  private readonly moveStack = new Int32Array(MAX_HISTORY);
  private readonly halfStack = new Int32Array(MAX_HISTORY);

  /** Đặt lại toàn bộ trạng thái từ một mảng bàn cờ. */
  setup(board: ArrayLike<number>, side: SideSign, halfmove = 0, fullmove = 1): void {
    this.board.set(board);
    this.side = side;
    this.halfmove = halfmove;
    this.fullmove = fullmove;
    this.kings[0] = -1;
    this.kings[1] = -1;
    this.counts.fill(0);
    this.hashLo = 0;
    this.hashHi = 0;
    this.pst = 0;
    for (let sq = 0; sq < SQUARES; sq++) {
      const p = this.board[sq];
      if (p === 0) continue;
      const idx = (p + 7) * 90 + sq;
      this.hashLo ^= Z_LO[idx];
      this.hashHi ^= Z_HI[idx];
      this.pst += PST[idx];
      this.counts[p + 7]++;
      if (p === KING) this.kings[0] = sq;
      else if (p === -KING) this.kings[1] = sq;
    }
    if (side === -1) {
      this.hashLo ^= Z_SIDE_LO;
      this.hashHi ^= Z_SIDE_HI;
    }
    this.histLen = 1;
    this.histLo[0] = this.hashLo >>> 0;
    this.histHi[0] = this.hashHi >>> 0;
    this.histCheck[0] = this.inCheck(side) ? 1 : 0;
  }

  clone(): Position {
    const p = new Position();
    p.setup(this.board, this.side, this.halfmove, this.fullmove);
    return p;
  }

  /** Hash dạng hex 16 ký tự, dùng cho state hash/replay/debug. */
  hashHex(): string {
    return (this.hashHi >>> 0).toString(16).padStart(8, '0') + (this.hashLo >>> 0).toString(16).padStart(8, '0');
  }

  // ---------------- Tấn công / chiếu ----------------

  /** Ô `sq` có bị bên `by` tấn công không. Dùng cho kiểm tra an toàn tướng (gồm luật tướng đối mặt). */
  isAttacked(sq: number, by: SideSign): boolean {
    const b = this.board;
    const rook = by * ROOK;
    const cannon = by * CANNON;
    const king = by * KING;
    for (let d = 0; d < 4; d++) {
      const ray = RAYS[sq][d];
      let i = 0;
      const n = ray.length;
      // quân đầu tiên trên tia
      for (; i < n; i++) {
        const p = b[ray[i]];
        if (p !== 0) {
          if (p === rook) return true;
          // Tướng đối mặt: tướng địch thẳng cột không có quân cản (d 0/1 là dọc).
          if (p === king && d < 2) return true;
          break;
        }
      }
      // quân thứ hai (ngòi pháo)
      for (i++; i < n; i++) {
        const p = b[ray[i]];
        if (p !== 0) {
          if (p === cannon) return true;
          break;
        }
      }
    }
    const horse = by * HORSE;
    const ha = HORSE_ATTACKERS[sq];
    for (let i = 0; i < ha.length; i++) {
      const e = ha[i];
      if (b[e[0]] === horse && b[e[1]] === 0) return true;
    }
    const pawn = by * PAWN;
    const pa = PAWN_ATTACKERS[by > 0 ? 0 : 1][sq];
    for (let i = 0; i < pa.length; i++) if (b[pa[i]] === pawn) return true;
    return false;
  }

  inCheck(side: SideSign = this.side): boolean {
    const k = this.kings[side > 0 ? 0 : 1];
    if (k < 0) return true; // không có tướng = trạng thái thua/không hợp lệ
    return this.isAttacked(k, (-side) as SideSign);
  }

  // ---------------- Sinh nước pseudo-legal ----------------

  /**
   * Ghi các nước pseudo-legal của bên đến lượt vào `out` bắt đầu từ `start`. Trả về chỉ số kết thúc.
   * Pseudo-legal: đúng cách đi của quân, không ăn quân mình, nhưng CHƯA kiểm tra tự chiếu/tướng đối mặt.
   */
  genMoves(out: Int32Array | number[], start: number, capturesOnly: boolean): number {
    const b = this.board;
    const s = this.side;
    const si = s > 0 ? 0 : 1;
    let n = start;
    for (let from = 0; from < SQUARES; from++) {
      const p = b[from] * s;
      if (p <= 0) continue;
      switch (p) {
        case KING: {
          const t = KING_MOVES[si][from];
          for (let i = 0; i < t.length; i++) {
            const to = t[i];
            const q = b[to] * s;
            if (q < 0 || (q === 0 && !capturesOnly)) out[n++] = from | (to << 7);
          }
          break;
        }
        case ADVISOR: {
          const t = ADVISOR_MOVES[si][from];
          for (let i = 0; i < t.length; i++) {
            const to = t[i];
            const q = b[to] * s;
            if (q < 0 || (q === 0 && !capturesOnly)) out[n++] = from | (to << 7);
          }
          break;
        }
        case ELEPHANT: {
          const t = ELEPHANT_MOVES[si][from];
          for (let i = 0; i < t.length; i++) {
            const to = t[i][0];
            if (b[t[i][1]] !== 0) continue; // cản tượng (mắt tượng)
            const q = b[to] * s;
            if (q < 0 || (q === 0 && !capturesOnly)) out[n++] = from | (to << 7);
          }
          break;
        }
        case HORSE: {
          const t = HORSE_MOVES[from];
          for (let i = 0; i < t.length; i++) {
            const to = t[i][0];
            if (b[t[i][1]] !== 0) continue; // cản mã (chân mã)
            const q = b[to] * s;
            if (q < 0 || (q === 0 && !capturesOnly)) out[n++] = from | (to << 7);
          }
          break;
        }
        case ROOK: {
          const rays = RAYS[from];
          for (let d = 0; d < 4; d++) {
            const ray = rays[d];
            for (let i = 0; i < ray.length; i++) {
              const to = ray[i];
              const q = b[to] * s;
              if (q === 0) {
                if (!capturesOnly) out[n++] = from | (to << 7);
              } else {
                if (q < 0) out[n++] = from | (to << 7);
                break;
              }
            }
          }
          break;
        }
        case CANNON: {
          const rays = RAYS[from];
          for (let d = 0; d < 4; d++) {
            const ray = rays[d];
            let i = 0;
            for (; i < ray.length; i++) {
              const to = ray[i];
              if (b[to] === 0) {
                if (!capturesOnly) out[n++] = from | (to << 7);
              } else break; // gặp ngòi
            }
            for (i++; i < ray.length; i++) {
              const to = ray[i];
              const q = b[to] * s;
              if (q !== 0) {
                if (q < 0) out[n++] = from | (to << 7);
                break;
              }
            }
          }
          break;
        }
        case PAWN: {
          const t = PAWN_MOVES[si][from];
          for (let i = 0; i < t.length; i++) {
            const to = t[i];
            const q = b[to] * s;
            if (q < 0 || (q === 0 && !capturesOnly)) out[n++] = from | (to << 7);
          }
          break;
        }
      }
    }
    return n;
  }

  // ---------------- Make / unmake ----------------

  /** Thực hiện nước (không kiểm tra hợp lệ). Trả về quân bị ăn (0 nếu không). */
  make(m: Move): number {
    const from = m & 127;
    const to = m >> 7;
    const b = this.board;
    const p = b[from];
    const cap = b[to];
    const k = this.histLen;
    this.capStack[k] = cap;
    this.moveStack[k] = m;
    this.halfStack[k] = this.halfmove;

    const fi = (p + 7) * 90;
    this.hashLo ^= Z_LO[fi + from] ^ Z_LO[fi + to] ^ Z_SIDE_LO;
    this.hashHi ^= Z_HI[fi + from] ^ Z_HI[fi + to] ^ Z_SIDE_HI;
    this.pst += PST[fi + to] - PST[fi + from];
    if (cap !== 0) {
      const ci = (cap + 7) * 90 + to;
      this.hashLo ^= Z_LO[ci];
      this.hashHi ^= Z_HI[ci];
      this.pst -= PST[ci];
      this.counts[cap + 7]--;
      if (cap === KING) this.kings[0] = -1;
      else if (cap === -KING) this.kings[1] = -1;
      this.halfmove = 0;
    } else {
      this.halfmove++;
    }
    b[to] = p;
    b[from] = 0;
    if (p === KING) this.kings[0] = to;
    else if (p === -KING) this.kings[1] = to;
    if (this.side === -1) this.fullmove++;
    this.side = -this.side as SideSign;

    this.histLo[k] = this.hashLo >>> 0;
    this.histHi[k] = this.hashHi >>> 0;
    this.histCheck[k] = -1;
    this.histLen = k + 1;
    return cap;
  }

  unmake(): void {
    const k = this.histLen - 1;
    const m = this.moveStack[k];
    const cap = this.capStack[k];
    const from = m & 127;
    const to = m >> 7;
    const b = this.board;
    const p = b[to];
    this.side = -this.side as SideSign;
    if (this.side === -1) this.fullmove--;
    b[from] = p;
    b[to] = cap;
    if (p === KING) this.kings[0] = from;
    else if (p === -KING) this.kings[1] = from;
    const fi = (p + 7) * 90;
    this.hashLo ^= Z_LO[fi + from] ^ Z_LO[fi + to] ^ Z_SIDE_LO;
    this.hashHi ^= Z_HI[fi + from] ^ Z_HI[fi + to] ^ Z_SIDE_HI;
    this.pst -= PST[fi + to] - PST[fi + from];
    if (cap !== 0) {
      const ci = (cap + 7) * 90 + to;
      this.hashLo ^= Z_LO[ci];
      this.hashHi ^= Z_HI[ci];
      this.pst += PST[ci];
      this.counts[cap + 7]++;
      if (cap === KING) this.kings[0] = to;
      else if (cap === -KING) this.kings[1] = to;
    }
    this.halfmove = this.halfStack[k];
    this.histLen = k;
  }

  /** Nước trống (null move) cho tìm kiếm. */
  makeNull(): void {
    const k = this.histLen;
    this.capStack[k] = 0;
    this.moveStack[k] = 0;
    this.halfStack[k] = this.halfmove;
    this.hashLo ^= Z_SIDE_LO;
    this.hashHi ^= Z_SIDE_HI;
    this.side = -this.side as SideSign;
    // Null move phá chuỗi lặp: đặt halfmove = 0 để không nhìn xuyên qua nó.
    this.halfmove = 0;
    this.histLo[k] = this.hashLo >>> 0;
    this.histHi[k] = this.hashHi >>> 0;
    this.histCheck[k] = 0;
    this.histLen = k + 1;
  }

  unmakeNull(): void {
    const k = this.histLen - 1;
    this.hashLo ^= Z_SIDE_LO;
    this.hashHi ^= Z_SIDE_HI;
    this.side = -this.side as SideSign;
    this.halfmove = this.halfStack[k];
    this.histLen = k;
  }

  /** Nước cuối cùng đã đi (0 nếu chưa có). */
  lastMove(): Move {
    return this.histLen > 1 ? this.moveStack[this.histLen - 1] : 0;
  }

  /** Thử nước pseudo-legal: hợp lệ nếu sau khi đi, tướng mình không bị tấn công (gồm tướng đối mặt). */
  isLegalPseudo(m: Move): boolean {
    const mover = this.side;
    this.make(m);
    const ok = !this.inCheck(mover);
    this.unmake();
    return ok;
  }

  /** Danh sách nước hợp lệ (legal) của bên đến lượt. */
  legalMoves(): Move[] {
    const buf: number[] = [];
    const n = this.genMoves(buf, 0, false);
    const res: Move[] = [];
    for (let i = 0; i < n; i++) if (this.isLegalPseudo(buf[i])) res.push(buf[i]);
    return res;
  }

  hasLegalMove(): boolean {
    const buf: number[] = [];
    const n = this.genMoves(buf, 0, false);
    for (let i = 0; i < n; i++) if (this.isLegalPseudo(buf[i])) return true;
    return false;
  }

  /** Kiểm tra một nước bất kỳ (from, to) có hợp lệ hoàn toàn hay không – an toàn với input sai. */
  isLegal(m: Move): boolean {
    const from = m & 127;
    const to = m >> 7;
    if (!Number.isInteger(m) || from >= SQUARES || to >= SQUARES || from === to) return false;
    if (this.board[from] * this.side <= 0) return false;
    const buf: number[] = [];
    const n = this.genMoves(buf, 0, false);
    for (let i = 0; i < n; i++) if (buf[i] === m) return this.isLegalPseudo(m);
    return false;
  }

  /** Bên nào còn quân có thể tấn công (xe, mã, pháo, tốt). */
  hasAttackers(side: SideSign): boolean {
    const c = this.counts;
    const o = 7;
    return c[o + side * ROOK] + c[o + side * HORSE] + c[o + side * CANNON] + c[o + side * PAWN] > 0;
  }

  /** Đánh dấu cờ chiếu cho vị trí hiện tại (dùng cho phát hiện trường chiếu). */
  setCheckFlag(inCheck: boolean): void {
    this.histCheck[this.histLen - 1] = inCheck ? 1 : 0;
  }

  private checkFlagAt(k: number): boolean {
    let f = this.histCheck[k];
    if (f === -1) {
      // Chưa biết: tính lại bằng cách không đổi trạng thái là không thể; trả về false thận trọng.
      f = 0;
    }
    return f === 1;
  }

  /**
   * Phát hiện lặp lại vị trí hiện tại trong cửa sổ kể từ lần ăn quân gần nhất.
   * @param minOccurrences số lần xuất hiện (tính cả hiện tại) để coi là lặp, ví dụ 3 cho luật ván, 2 cho tìm kiếm.
   * @returns null nếu chưa lặp; ngược lại thông tin trường chiếu trong chu kỳ.
   */
  detectRepetition(minOccurrences: number): null | { redPerpetual: boolean; blackPerpetual: boolean } {
    const cur = this.histLen - 1;
    const window = Math.min(this.halfmove, cur);
    const lo = this.histLo[cur];
    const hi = this.histHi[cur];
    let count = 1;
    let firstIdx = -1;
    for (let k = cur - 2; k >= cur - window; k -= 2) {
      if (this.histLo[k] === lo && this.histHi[k] === hi) {
        count++;
        firstIdx = k;
        if (count >= minOccurrences) break;
      }
    }
    if (count < minOccurrences) return null;
    // Trong đoạn (firstIdx, cur]: vị trí k có bên-đến-lượt bị chiếu => nước thứ k (của bên vừa đi) là nước chiếu.
    // Bên đi nước thứ k: side ở vị trí k là bên bị đi tới; người đi = -side(k).
    // side ở vị trí cur = this.side; vị trí k có side = this.side * (-1)^(cur-k).
    let redMoves = 0;
    let blackMoves = 0;
    let redChecks = 0;
    let blackChecks = 0;
    for (let k = firstIdx + 1; k <= cur; k++) {
      const sideAtK = (cur - k) % 2 === 0 ? this.side : -this.side;
      const mover = -sideAtK;
      const check = this.checkFlagAt(k);
      if (mover > 0) {
        redMoves++;
        if (check) redChecks++;
      } else {
        blackMoves++;
        if (check) blackChecks++;
      }
    }
    return {
      redPerpetual: redMoves > 0 && redChecks === redMoves,
      blackPerpetual: blackMoves > 0 && blackChecks === blackMoves,
    };
  }
}
