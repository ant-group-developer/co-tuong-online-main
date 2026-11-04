/**
 * Hàm đánh giá thế trận (centipawn, theo góc nhìn bên đến lượt).
 * = material + PST (cập nhật tăng dần trong Position) + an toàn tướng + điều chỉnh tàn cuộc + tempo.
 */
import type { Position } from '../position.js';
import { ADVISOR, CANNON, ELEPHANT, HORSE, PAWN, ROOK } from '../types.js';

const O = 7;
const TEMPO = 10;

export function evaluate(pos: Position): number {
  const c = pos.counts;
  let score = pos.pst;

  const redRooks = c[O + ROOK];
  const blackRooks = c[O - ROOK];
  const redHorses = c[O + HORSE];
  const blackHorses = c[O - HORSE];
  const redCannons = c[O + CANNON];
  const blackCannons = c[O - CANNON];

  // An toàn tướng: thiếu sĩ/tượng khi đối phương còn quân tấn công mạnh.
  const redDef = c[O + ADVISOR] + c[O + ELEPHANT];
  const blackDef = c[O - ADVISOR] + c[O - ELEPHANT];
  const redAtk = blackRooks * 2 + blackHorses + blackCannons; // áp lực lên Đỏ
  const blackAtk = redRooks * 2 + redHorses + redCannons;
  score -= (4 - redDef) * redAtk * 7;
  score += (4 - blackDef) * blackAtk * 7;

  // Tàn cuộc: ít quân lớn => pháo yếu đi (thiếu ngòi), mã mạnh lên.
  const heavy = redRooks + blackRooks + redHorses + blackHorses + redCannons + blackCannons;
  if (heavy <= 6) {
    const k = 6 - heavy; // 0..6
    score += (redHorses - blackHorses) * 4 * k;
    score -= (redCannons - blackCannons) * 5 * k;
    // Tốt quý hơn ở tàn cuộc.
    score += (c[O + PAWN] - c[O - PAWN]) * 3 * k;
  }

  // Cặp pháo + xe tạo áp lực tốt hơn khi đủ ngòi (khai/trung cuộc).
  if (heavy > 8) {
    score += (redCannons - blackCannons) * 6;
  }

  return pos.side * score + TEMPO;
}

/** Giá trị quân dùng cho sắp xếp MVV-LVA và delta pruning. */
export const PIECE_VALUE = [0, 6000, 200, 200, 420, 900, 450, 100];
