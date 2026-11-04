/**
 * Ánh xạ hiển thị. Tọa độ canonical không bao giờ đổi; lật bàn chỉ đổi cách vẽ và cách hiểu click/tap.
 */
import { colOf, rowOf, sqOf } from './tables.js';

export interface ViewCell {
  row: number;
  col: number;
}

/** Ô canonical -> vị trí hiển thị (row/col trên màn hình). */
export function toView(sq: number, flipped: boolean): ViewCell {
  const r = rowOf(sq);
  const c = colOf(sq);
  return flipped ? { row: 9 - r, col: 8 - c } : { row: r, col: c };
}

/** Vị trí hiển thị -> ô canonical. */
export function fromView(row: number, col: number, flipped: boolean): number {
  return flipped ? sqOf(9 - row, 8 - col) : sqOf(row, col);
}
