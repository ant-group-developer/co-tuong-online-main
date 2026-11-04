/**
 * Bảng tiền tính toán (precomputed) cho sinh nước và kiểm tra bị tấn công.
 * Mọi ràng buộc biên bàn, cung, sông, cản mã, cản tượng được mã hóa tại đây một lần,
 * giúp vòng sinh nước vừa nhanh vừa khó sai.
 */
import { COLS, ROWS, SQUARES } from './types.js';

export const sqOf = (row: number, col: number): number => row * COLS + col;
export const rowOf = (sq: number): number => (sq / COLS) | 0;
export const colOf = (sq: number): number => sq % COLS;
const inBoard = (r: number, c: number): boolean => r >= 0 && r < ROWS && c >= 0 && c < COLS;

/** signIdx: 0 = Đỏ (sign 1), 1 = Đen (sign -1). */
export const signIdx = (sign: number): 0 | 1 => (sign > 0 ? 0 : 1);

export const inPalace = (si: 0 | 1, r: number, c: number): boolean =>
  c >= 3 && c <= 5 && (si === 0 ? r >= 7 && r <= 9 : r >= 0 && r <= 2);

/** Nửa bàn của bên (chưa qua sông). Đỏ: row 5..9, Đen: row 0..4. */
export const inOwnHalf = (si: 0 | 1, r: number): boolean => (si === 0 ? r >= 5 : r <= 4);

/** Tia 4 hướng: 0 lên (row-1), 1 xuống (row+1), 2 trái, 3 phải. */
export const RAYS: number[][][] = [];
export const KING_MOVES: number[][][] = [[], []];
export const ADVISOR_MOVES: number[][][] = [[], []];
/** [to, eye][] */
export const ELEPHANT_MOVES: number[][][][] = [[], []];
/** [to, leg][] */
export const HORSE_MOVES: number[][][] = [];
/** [from, leg][]: các ô mà mã đứng sẽ tấn công ô này (leg = chân mã cạnh ô `from`). */
export const HORSE_ATTACKERS: number[][][] = [];
export const PAWN_MOVES: number[][][] = [[], []];
/** PAWN_ATTACKERS[si][sq]: các ô mà tốt của bên si đứng sẽ tấn công sq. */
export const PAWN_ATTACKERS: number[][][] = [[], []];

const ORTHO: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const DIAG: Array<[number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
const HORSE_DELTAS: Array<[number, number]> = [
  [-2, -1],
  [-2, 1],
  [2, -1],
  [2, 1],
  [-1, -2],
  [1, -2],
  [-1, 2],
  [1, 2],
];

/** Chân mã cho bước (dr, dc) xuất phát từ (r, c). */
function horseLeg(r: number, c: number, dr: number, dc: number): number {
  return Math.abs(dr) === 2 ? sqOf(r + dr / 2, c) : sqOf(r, c + dc / 2);
}

for (let sq = 0; sq < SQUARES; sq++) {
  const r = rowOf(sq);
  const c = colOf(sq);

  RAYS[sq] = ORTHO.map(([dr, dc]) => {
    const ray: number[] = [];
    let rr = r + dr;
    let cc = c + dc;
    while (inBoard(rr, cc)) {
      ray.push(sqOf(rr, cc));
      rr += dr;
      cc += dc;
    }
    return ray;
  });

  HORSE_MOVES[sq] = [];
  HORSE_ATTACKERS[sq] = [];
  for (const [dr, dc] of HORSE_DELTAS) {
    const tr = r + dr;
    const tc = c + dc;
    if (inBoard(tr, tc)) {
      HORSE_MOVES[sq].push([sqOf(tr, tc), horseLeg(r, c, dr, dc)]);
    }
    // Mã đứng ở (fr, fc) nhảy (dr, dc) tới (r, c)
    const fr = r - dr;
    const fc = c - dc;
    if (inBoard(fr, fc)) {
      HORSE_ATTACKERS[sq].push([sqOf(fr, fc), horseLeg(fr, fc, dr, dc)]);
    }
  }

  for (const si of [0, 1] as const) {
    KING_MOVES[si][sq] = [];
    ADVISOR_MOVES[si][sq] = [];
    ELEPHANT_MOVES[si][sq] = [];
    PAWN_MOVES[si][sq] = [];
    PAWN_ATTACKERS[si][sq] = [];

    if (inPalace(si, r, c)) {
      for (const [dr, dc] of ORTHO) {
        if (inBoard(r + dr, c + dc) && inPalace(si, r + dr, c + dc)) KING_MOVES[si][sq].push(sqOf(r + dr, c + dc));
      }
      for (const [dr, dc] of DIAG) {
        if (inBoard(r + dr, c + dc) && inPalace(si, r + dr, c + dc)) ADVISOR_MOVES[si][sq].push(sqOf(r + dr, c + dc));
      }
    }
    if (inOwnHalf(si, r)) {
      for (const [dr, dc] of DIAG) {
        const tr = r + 2 * dr;
        const tc = c + 2 * dc;
        if (inBoard(tr, tc) && inOwnHalf(si, tr)) {
          ELEPHANT_MOVES[si][sq].push([sqOf(tr, tc), sqOf(r + dr, c + dc)]);
        }
      }
    }

    // Tốt: Đỏ đi lên (row-1), Đen đi xuống (row+1); qua sông được đi ngang.
    const fwd = si === 0 ? -1 : 1;
    if (inBoard(r + fwd, c)) PAWN_MOVES[si][sq].push(sqOf(r + fwd, c));
    if (!inOwnHalf(si, r)) {
      if (c > 0) PAWN_MOVES[si][sq].push(sqOf(r, c - 1));
      if (c < COLS - 1) PAWN_MOVES[si][sq].push(sqOf(r, c + 1));
    }
  }
}

// Bảng tấn công của tốt suy ra từ bảng nước đi (đảm bảo nhất quán).
for (const si of [0, 1] as const) {
  for (let from = 0; from < SQUARES; from++) {
    for (const to of PAWN_MOVES[si][from]) PAWN_ATTACKERS[si][to].push(from);
  }
}
