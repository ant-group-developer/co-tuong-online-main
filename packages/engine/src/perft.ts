/** Perft: đếm số nút lá hợp lệ ở độ sâu d – chuẩn kiểm chứng bộ sinh nước. */
import type { Position } from './position.js';

export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const buf: number[] = [];
  const n = pos.genMoves(buf, 0, false);
  const mover = pos.side;
  let total = 0;
  for (let i = 0; i < n; i++) {
    pos.make(buf[i]);
    if (!pos.inCheck(mover)) total += depth === 1 ? 1 : perft(pos, depth - 1);
    pos.unmake();
  }
  return total;
}
