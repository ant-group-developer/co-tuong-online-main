/**
 * Kiểu dữ liệu cơ bản của engine cờ tướng.
 *
 * Tọa độ canonical (bất biến cho mọi người chơi/người xem):
 *   - Ô = row * 9 + col, row 0..9 từ trên xuống, col 0..8 từ trái sang.
 *   - Row 0 là hàng cuối của Đen, row 9 là hàng cuối của Đỏ (Đỏ luôn ở dưới trong canonical).
 *   - Lật bàn chỉ là phép biến đổi hiển thị (xem `view.ts`), KHÔNG đổi dữ liệu.
 *
 * Ký hiệu nước đi ICCS: file a..i = col 0..8, rank 0..9 = 9 - row. Ví dụ "h2e2" (pháo đầu).
 */

export type Side = 'red' | 'black';

/** Loại quân (giá trị tuyệt đối trên bàn). Dùng hằng số thay vì enum để chạy nhanh trong vòng lặp tìm kiếm. */
export const KING = 1;
export const ADVISOR = 2;
export const ELEPHANT = 3;
export const HORSE = 4;
export const ROOK = 5;
export const CANNON = 6;
export const PAWN = 7;
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Giá trị số của bên: Đỏ = 1, Đen = -1. Quân trên bàn = type * sign. */
export type SideSign = 1 | -1;

export interface Piece {
  type: PieceType;
  side: Side;
}

/** Nước đi đóng gói: from | (to << 7). */
export type Move = number;

export const NO_MOVE = 0 as Move;

export const ROWS = 10;
export const COLS = 9;
export const SQUARES = 90;

export type GameResult = 'red' | 'black' | 'draw';

export type EndReason =
  | 'checkmate' // bị chiếu hết
  | 'no_legal_moves' // hết nước đi (không bị chiếu) – vẫn là thua trong cờ tướng
  | 'perpetual_check' // trường chiếu (bên chiếu liên tục bị xử thua)
  | 'repetition' // lặp lại 3 lần, không bên nào trường chiếu -> hòa
  | 'no_progress' // 120 nửa nước không ăn quân -> hòa
  | 'insufficient_material' // không bên nào còn quân tấn công -> hòa
  | 'max_plies' // vượt giới hạn số nửa nước an toàn -> hòa
  | 'resign'
  | 'timeout'
  | 'draw_agreement'
  | 'abandon'
  | 'aborted';

export interface GameStatus {
  over: boolean;
  result?: GameResult;
  reason?: EndReason;
  /** Bên đang bị chiếu (bên đến lượt), nếu có. */
  inCheck: boolean;
}

export const sideToSign = (s: Side): SideSign => (s === 'red' ? 1 : -1);
export const signToSide = (s: number): Side => (s > 0 ? 'red' : 'black');
export const opposite = (s: Side): Side => (s === 'red' ? 'black' : 'red');
