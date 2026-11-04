/**
 * FEN cờ tướng (định dạng phổ biến của WXF/UCCI):
 *   "<10 hàng từ hàng 0 (Đen) tới hàng 9 (Đỏ), ngăn cách '/'> <w|b> - - <halfmove> <fullmove>"
 * Chữ hoa = Đỏ, chữ thường = Đen. K tướng, A sĩ, B tượng (chấp nhận E), N mã (chấp nhận H), R xe, C pháo, P tốt.
 * 'w' (hoặc 'r') = Đỏ đi, 'b' = Đen đi.
 */
import { Position } from './position.js';
import { inOwnHalf, inPalace, rowOf, colOf } from './tables.js';
import { ADVISOR, CANNON, ELEPHANT, HORSE, KING, PAWN, ROOK, SQUARES, type SideSign } from './types.js';

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

const CHAR_TO_TYPE: Record<string, number> = {
  k: KING,
  a: ADVISOR,
  b: ELEPHANT,
  e: ELEPHANT,
  n: HORSE,
  h: HORSE,
  r: ROOK,
  c: CANNON,
  p: PAWN,
};
const TYPE_TO_CHAR = ['', 'k', 'a', 'b', 'n', 'r', 'c', 'p'];

export class FenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FenError';
  }
}

export interface ParsedFen {
  board: Int8Array;
  side: SideSign;
  halfmove: number;
  fullmove: number;
}

export function parseFen(fen: string): ParsedFen {
  if (typeof fen !== 'string' || fen.length > 200) throw new FenError('FEN không hợp lệ');
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0]?.split('/') ?? [];
  if (rows.length !== 10) throw new FenError('FEN phải có 10 hàng');
  const board = new Int8Array(SQUARES);
  for (let r = 0; r < 10; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '9') {
        c += Number(ch);
      } else {
        const t = CHAR_TO_TYPE[ch.toLowerCase()];
        if (!t) throw new FenError(`Ký tự quân không hợp lệ: ${ch}`);
        if (c >= 9) throw new FenError(`Hàng ${r} quá 9 cột`);
        board[r * 9 + c] = ch === ch.toUpperCase() ? t : -t;
        c++;
      }
      if (c > 9) throw new FenError(`Hàng ${r} quá 9 cột`);
    }
    if (c !== 9) throw new FenError(`Hàng ${r} không đủ 9 cột`);
  }
  const sideStr = (parts[1] ?? 'w').toLowerCase();
  if (sideStr !== 'w' && sideStr !== 'r' && sideStr !== 'b') throw new FenError('Lượt đi không hợp lệ');
  const side: SideSign = sideStr === 'b' ? -1 : 1;
  const halfmove = parts[4] !== undefined ? Number(parts[4]) : 0;
  const fullmove = parts[5] !== undefined ? Number(parts[5]) : 1;
  if (!Number.isInteger(halfmove) || halfmove < 0 || halfmove > 1000) throw new FenError('halfmove không hợp lệ');
  if (!Number.isInteger(fullmove) || fullmove < 1 || fullmove > 10000) throw new FenError('fullmove không hợp lệ');
  validateBoard(board, side);
  return { board, side, halfmove, fullmove };
}

/** Kiểm tra cấu hình bàn có thể xảy ra: đúng 1 tướng mỗi bên, quân nằm trong vùng được phép, bên không đến lượt không bị chiếu. */
export function validateBoard(board: Int8Array, side: SideSign): void {
  const counts = new Map<number, number>();
  for (let sq = 0; sq < SQUARES; sq++) {
    const p = board[sq];
    if (p === 0) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
    const t = Math.abs(p);
    const si = p > 0 ? 0 : 1;
    const r = rowOf(sq);
    const c = colOf(sq);
    if (t === KING && !inPalace(si, r, c)) throw new FenError('Tướng nằm ngoài cung');
    if (t === ADVISOR) {
      const ok = inPalace(si, r, c) && (c === 4) === (r === (si === 0 ? 8 : 1));
      if (!ok) throw new FenError('Sĩ nằm sai vị trí');
    }
    if (t === ELEPHANT && !isElephantSquare(si, r, c)) throw new FenError('Tượng nằm sai vị trí');
    if (t === PAWN) {
      // Tốt không thể lùi: Đỏ không thể ở hàng 7..9 (sau vị trí xuất phát), Đen không ở 0..2.
      if (si === 0 ? r > 6 : r < 3) throw new FenError('Tốt nằm sai vị trí');
      // Chưa qua sông thì chỉ ở cột chẵn.
      if (inOwnHalf(si, r) && c % 2 !== 0) throw new FenError('Tốt nằm sai vị trí');
    }
  }
  const limit: Record<number, number> = { [KING]: 1, [ADVISOR]: 2, [ELEPHANT]: 2, [HORSE]: 2, [ROOK]: 2, [CANNON]: 2, [PAWN]: 5 };
  for (const [p, n] of counts) {
    if (n > limit[Math.abs(p)]) throw new FenError('Số lượng quân vượt quá giới hạn');
  }
  if (counts.get(KING) !== 1 || counts.get(-KING) !== 1) throw new FenError('Mỗi bên phải có đúng một tướng');
  const pos = new Position();
  pos.setup(board, side);
  if (pos.inCheck((-side) as SideSign)) throw new FenError('Bên không đến lượt đang bị chiếu');
}

function isElephantSquare(si: 0 | 1, r: number, c: number): boolean {
  const red: Array<[number, number]> = [
    [9, 2],
    [9, 6],
    [7, 0],
    [7, 4],
    [7, 8],
    [5, 2],
    [5, 6],
  ];
  return red.some(([rr, cc]) => (si === 0 ? rr === r : 9 - rr === r) && cc === c);
}

export function positionFromFen(fen: string): Position {
  const { board, side, halfmove, fullmove } = parseFen(fen);
  const p = new Position();
  p.setup(board, side, halfmove, fullmove);
  return p;
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let r = 0; r < 10; r++) {
    let s = '';
    let empty = 0;
    for (let c = 0; c < 9; c++) {
      const p = pos.board[r * 9 + c];
      if (p === 0) {
        empty++;
        continue;
      }
      if (empty) {
        s += empty;
        empty = 0;
      }
      const ch = TYPE_TO_CHAR[Math.abs(p)];
      s += p > 0 ? ch.toUpperCase() : ch;
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return `${rows.join('/')} ${pos.side > 0 ? 'w' : 'b'} - - ${pos.halfmove} ${pos.fullmove}`;
}
