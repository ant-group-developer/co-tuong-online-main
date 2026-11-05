/** So sánh bàn để biết có diễn hoạt cảnh "cầm quân" hay đặt quân ngay (không phụ thuộc three.js, dễ kiểm thử). */
export interface MoveRef {
  from: number;
  to: number;
}

export function sameBoard(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let i = 0; i < 90; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** `next` là `cur` sau đúng nước `m`: from trống, to nhận đúng quân từ from, các ô khác giữ nguyên. */
export function isSingleMove(cur: ArrayLike<number>, next: ArrayLike<number>, m: MoveRef): boolean {
  if (!cur[m.from] || next[m.from] !== 0 || next[m.to] !== cur[m.from]) return false;
  if (cur[m.to] && Math.sign(cur[m.to]) === Math.sign(cur[m.from])) return false;
  for (let i = 0; i < 90; i++) if (i !== m.from && i !== m.to && cur[i] !== next[i]) return false;
  return true;
}
