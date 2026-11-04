/**
 * Ký hiệu nước đi.
 *  - ICCS (máy đọc, dùng cho lưu trữ/giao thức): "h2e2" – file a..i = col 0..8, rank 0..9 = 9 - row.
 *  - Ký hiệu Việt (hiển thị): "P2-5" (pháo 2 bình 5), "M8.7" (mã 8 tiến 7), "X1/2" (xe 1 thoái 2).
 *    Cột tính từ phải sang trái theo góc nhìn của bên đi (1..9). Tiến ".", thoái "/", bình "-".
 *  - Ký hiệu quốc tế WXF (giao diện tiếng Anh): "C2=5", "H8+7", "R1-2".
 */
import type { Position } from './position.js';
import { makeMove } from './position.js';
import { colOf, rowOf, sqOf } from './tables.js';
import { ADVISOR, CANNON, ELEPHANT, HORSE, KING, PAWN, ROOK, type Move } from './types.js';

const FILES = 'abcdefghi';

export function squareToIccs(sq: number): string {
  return FILES[colOf(sq)] + String(9 - rowOf(sq));
}

export function iccsToSquare(s: string): number {
  if (typeof s !== 'string' || s.length !== 2) return -1;
  const c = FILES.indexOf(s[0]);
  const rank = s.charCodeAt(1) - 48;
  if (c < 0 || rank < 0 || rank > 9) return -1;
  return sqOf(9 - rank, c);
}

export function moveToIccs(m: Move): string {
  return squareToIccs(m & 127) + squareToIccs(m >> 7);
}

/** Phân tích "h2e2" -> Move, trả về -1 nếu sai định dạng (không ném lỗi). */
export function iccsToMove(s: string): Move {
  if (typeof s !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(s)) return -1;
  const from = iccsToSquare(s.slice(0, 2));
  const to = iccsToSquare(s.slice(2, 4));
  if (from < 0 || to < 0 || from === to) return -1;
  return makeMove(from, to);
}

const VN_LETTER: Record<number, string> = {
  [KING]: 'Tg',
  [ADVISOR]: 'S',
  [ELEPHANT]: 'T',
  [HORSE]: 'M',
  [ROOK]: 'X',
  [CANNON]: 'P',
  [PAWN]: 'B',
};

export const PIECE_NAME_VI: Record<number, string> = {
  [KING]: 'Tướng',
  [ADVISOR]: 'Sĩ',
  [ELEPHANT]: 'Tượng',
  [HORSE]: 'Mã',
  [ROOK]: 'Xe',
  [CANNON]: 'Pháo',
  [PAWN]: 'Tốt',
};

/** Số cột theo góc nhìn bên đi (1..9, tính từ phải sang). */
function fileNumber(sign: number, col: number): number {
  return sign > 0 ? 9 - col : col + 1;
}

interface NotationStyle {
  letters: Record<number, string>;
  /** Hai quân cùng loại trên một cột: ký hiệu quân trước / sau. */
  front: string;
  rear: string;
  /** true: dấu trước/sau đặt SAU chữ quân (Việt: "Xt"); false: đặt TRƯỚC (WXF: "+R"). */
  tandemAfterLetter: boolean;
  advance: string;
  retreat: string;
  traverse: string;
}

const VN_STYLE: NotationStyle = { letters: VN_LETTER, front: 't', rear: 's', tandemAfterLetter: true, advance: '.', retreat: '/', traverse: '-' };

/** Ký hiệu quốc tế WXF: K/A/E/H/R/C/P, tiến "+", thoái "-", bình "=". Ví dụ "C2=5", "H8+7", "+R-1". */
const WXF_STYLE: NotationStyle = {
  letters: { [KING]: "K", [ADVISOR]: "A", [ELEPHANT]: "E", [HORSE]: "H", [ROOK]: "R", [CANNON]: "C", [PAWN]: "P" },
  front: "+",
  rear: "-",
  tandemAfterLetter: false,
  advance: "+",
  retreat: "-",
  traverse: "=",
};

function moveNotation(pos: Position, m: Move, st: NotationStyle): string {
  const from = m & 127;
  const to = m >> 7;
  const p = pos.board[from];
  if (p === 0) return moveToIccs(m);
  const sign = p > 0 ? 1 : -1;
  const t = Math.abs(p);
  const fc = colOf(from);
  const fr = rowOf(from);
  const tc = colOf(to);
  const tr = rowOf(to);

  // Phân biệt trước/sau khi có 2 quân cùng loại trên cùng cột.
  let prefix = st.letters[t] + fileNumber(sign, fc);
  const sameFile: number[] = [];
  for (let r = 0; r < 10; r++) if (pos.board[sqOf(r, fc)] === p) sameFile.push(r);
  if (sameFile.length === 2 && t !== KING && t !== ADVISOR && t !== ELEPHANT) {
    // "trước" là quân gần phía đối phương hơn.
    const front = sign > 0 ? Math.min(...sameFile) : Math.max(...sameFile);
    const mark = fr === front ? st.front : st.rear;
    prefix = st.tandemAfterLetter ? st.letters[t] + mark : mark + st.letters[t];
  }

  const forwardRows = sign > 0 ? fr - tr : tr - fr; // > 0 là tiến
  let action: string;
  let target: number;
  if (tr === fr) {
    action = st.traverse;
    target = fileNumber(sign, tc);
  } else {
    action = forwardRows > 0 ? st.advance : st.retreat;
    const straight = t === ROOK || t === CANNON || t === PAWN || t === KING;
    target = straight ? Math.abs(forwardRows) : fileNumber(sign, tc);
  }
  return `${prefix}${action}${target}`;
}

/** Ký hiệu Việt cho nước `m` tại vị trí `pos` (trước khi đi). */
export function moveToVietnamese(pos: Position, m: Move): string {
  return moveNotation(pos, m, VN_STYLE);
}

/** Ký hiệu quốc tế WXF cho nước `m` tại vị trí `pos` (trước khi đi). */
export function moveToWxf(pos: Position, m: Move): string {
  return moveNotation(pos, m, WXF_STYLE);
}
