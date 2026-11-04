/**
 * Giá trị quân + bảng vị trí (piece-square tables), đơn vị centipawn (1 tốt chưa qua sông ≈ 100).
 * Bảng viết theo góc nhìn Đỏ (row 0 = hàng cuối của Đen). Bảng của Đen là ảnh gương theo hàng.
 * Đây là bảng tự thiết kế dựa trên nguyên tắc phổ biến của cờ tướng (tốt qua sông/áp cung mạnh,
 * mã trung tâm, pháo đầu, xe trên đường mở), không chép từ engine nào.
 */
import { ADVISOR, CANNON, ELEPHANT, HORSE, KING, PAWN, ROOK } from './types.js';

export const MATERIAL: number[] = [0, 0, 200, 200, 420, 900, 450, 100];

const Z = [0, 0, 0, 0, 0, 0, 0, 0, 0];

const PAWN_T = [
  [0, 3, 6, 9, 12, 9, 6, 3, 0],
  [18, 36, 56, 80, 120, 80, 56, 36, 18],
  [14, 26, 42, 60, 80, 60, 42, 26, 14],
  [10, 20, 30, 34, 40, 34, 30, 20, 10],
  [6, 12, 18, 18, 20, 18, 18, 12, 6],
  [2, 0, 8, 0, 8, 0, 8, 0, 2],
  [0, 0, -2, 0, 4, 0, -2, 0, 0],
  Z,
  Z,
  Z,
];

const HORSE_T = [
  [4, 8, 16, 12, 4, 12, 16, 8, 4],
  [4, 10, 28, 16, 8, 16, 28, 10, 4],
  [12, 14, 16, 20, 18, 20, 16, 14, 12],
  [8, 24, 18, 24, 20, 24, 18, 24, 8],
  [6, 16, 14, 18, 16, 18, 14, 16, 6],
  [4, 12, 16, 14, 12, 14, 16, 12, 4],
  [2, 6, 8, 6, 10, 6, 8, 6, 2],
  [4, 2, 8, 8, 4, 8, 8, 2, 4],
  [0, 2, 4, 4, -2, 4, 4, 2, 0],
  [0, -4, 0, 0, 0, 0, 0, -4, 0],
];

const ROOK_T = [
  [14, 14, 12, 18, 16, 18, 12, 14, 14],
  [16, 20, 18, 24, 26, 24, 18, 20, 16],
  [12, 12, 12, 18, 18, 18, 12, 12, 12],
  [12, 18, 16, 22, 22, 22, 16, 18, 12],
  [12, 14, 12, 18, 18, 18, 12, 14, 12],
  [12, 16, 14, 20, 20, 20, 14, 16, 12],
  [6, 10, 8, 14, 14, 14, 8, 10, 6],
  [4, 8, 6, 14, 12, 14, 6, 8, 4],
  [8, 4, 8, 16, 8, 16, 8, 4, 8],
  [-2, 10, 6, 14, 12, 14, 6, 10, -2],
];

const CANNON_T = [
  [6, 4, 0, -10, -12, -10, 0, 4, 6],
  [2, 2, 0, -4, -14, -4, 0, 2, 2],
  [2, 2, 0, -10, -8, -10, 0, 2, 2],
  [0, 0, -2, 4, 10, 4, -2, 0, 0],
  [0, 0, 0, 2, 8, 2, 0, 0, 0],
  [-2, 0, 4, 2, 6, 2, 4, 0, -2],
  [0, 0, 0, 2, 4, 2, 0, 0, 0],
  [4, 0, 8, 6, 10, 6, 8, 0, 4],
  [0, 2, 4, 6, 6, 6, 4, 2, 0],
  [0, 0, 2, 6, 6, 6, 2, 0, 0],
];

const ADVISOR_T = [Z, Z, Z, Z, Z, Z, Z, [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 3, 0, 0, 0, 0], Z];

const ELEPHANT_T = [
  Z,
  Z,
  Z,
  Z,
  Z,
  [0, 0, -2, 0, 0, 0, -2, 0, 0],
  Z,
  [-2, 0, 0, 0, 3, 0, 0, 0, -2],
  Z,
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const KING_T = [
  Z,
  Z,
  Z,
  Z,
  Z,
  Z,
  Z,
  [0, 0, 0, -18, -15, -18, 0, 0, 0],
  [0, 0, 0, -10, -8, -10, 0, 0, 0],
  [0, 0, 0, -4, 0, -4, 0, 0, 0],
];

const TABLES: Record<number, number[][]> = {
  [KING]: KING_T,
  [ADVISOR]: ADVISOR_T,
  [ELEPHANT]: ELEPHANT_T,
  [HORSE]: HORSE_T,
  [ROOK]: ROOK_T,
  [CANNON]: CANNON_T,
  [PAWN]: PAWN_T,
};

/**
 * PST[(piece + 7) * 90 + sq] = điểm (material + vị trí) theo góc nhìn của chính bên sở hữu quân đó,
 * đã đổi dấu: quân Đỏ dương, quân Đen âm => tổng = điểm theo góc nhìn Đỏ.
 */
export const PST = new Int16Array(15 * 90);
for (let t = 1; t <= 7; t++) {
  const table = TABLES[t];
  for (let sq = 0; sq < 90; sq++) {
    const r = (sq / 9) | 0;
    const c = sq % 9;
    PST[(t + 7) * 90 + sq] = MATERIAL[t] + table[r][c];
    // Đen: gương theo hàng (row -> 9 - row), đổi dấu.
    PST[(-t + 7) * 90 + sq] = -(MATERIAL[t] + table[9 - r][c]);
  }
}
