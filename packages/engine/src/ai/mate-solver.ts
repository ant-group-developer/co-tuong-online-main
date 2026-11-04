/**
 * Solver vét cạn (không heuristic) dùng để KIỂM CHỨNG tactical suite, độc lập với Searcher.
 * Trong cờ tướng, bên hết nước đi (bị chiếu hết hoặc không) đều thua.
 */
import type { Position } from '../position.js';
import type { Move } from '../types.js';

/** Bên đến lượt có thể ép thắng (đối phương hết nước) trong tối đa n nước của mình không. */
export function canForceWin(pos: Position, n: number): boolean {
  if (n <= 0) return false;
  for (const m of pos.legalMoves()) {
    if (moveForcesWin(pos, m, n)) return true;
  }
  return false;
}

/** Nước m có ép thắng trong n nước (tính cả m) không. */
export function moveForcesWin(pos: Position, m: Move, n: number): boolean {
  pos.make(m);
  try {
    const replies = pos.legalMoves();
    if (replies.length === 0) return true;
    if (n <= 1) return false;
    for (const r of replies) {
      pos.make(r);
      const ok = canForceWin(pos, n - 1);
      pos.unmake();
      if (!ok) return false;
    }
    return true;
  } finally {
    pos.unmake();
  }
}

/** Nước phòng thủ `m` (của bên đến lượt) có ngăn được đối phương thắng trong n nước không. */
export function moveDefends(pos: Position, m: Move, n: number): boolean {
  pos.make(m);
  try {
    return !canForceWin(pos, n);
  } finally {
    pos.unmake();
  }
}
