/**
 * Sinh tactical suite có đáp án được kiểm chứng bằng solver vét cạn.
 *   - m1/m2/m3: Đỏ đi, có thể ép thắng trong đúng N nước (không có lời giải ngắn hơn).
 *   - d1: Đen đi, Đỏ đang dọa thắng trong 1 nước; tồn tại nước phòng thủ, nhưng không phải mọi nước đều giữ được.
 * Kết quả ghi ra test/fixtures/tactics.json. Chạy: npx tsx scripts/gen-tactics.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Position, toFen, moveToIccs, parseFen } from '../src/index.js';
import { canForceWin, moveDefends, moveForcesWin } from '../src/ai/mate-solver.js';

let seed = 20261104;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];

const RED_PALACE = [66, 67, 68, 75, 76, 77, 84, 85, 86];
const BLACK_PALACE = [3, 4, 5, 12, 13, 14, 21, 22, 23];
const RED_ADV = [84, 86, 76, 66, 68];
const BLACK_ADV = [3, 5, 13, 21, 23];
const BLACK_ELE = [2, 6, 18, 22, 26, 38, 42];

function randomPosition(): Position | null {
  const b = new Int8Array(90);
  const put = (sq: number, p: number) => {
    if (b[sq] !== 0) return false;
    b[sq] = p;
    return true;
  };
  put(pick(RED_PALACE), 1);
  if (!put(pick(BLACK_PALACE), -1)) return null;
  // Phòng thủ của Đen
  const nDef = Math.floor(rand() * 4);
  for (let i = 0; i < nDef; i++) {
    if (rand() < 0.6) put(pick(BLACK_ADV), -2);
    else put(pick(BLACK_ELE), -3);
  }
  if (rand() < 0.5) put(Math.floor(rand() * 45), -7 * (rand() < 0.5 ? 1 : 0) || -5);
  // Quân tấn công của Đỏ (nửa trên bàn)
  const attackers = [5, 5, 4, 6, 4, 6, 7];
  const nAtk = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < nAtk; i++) {
    const t = pick(attackers);
    const sq = t === 7 ? Math.floor(rand() * 36) : Math.floor(rand() * 63);
    put(sq, t);
  }
  if (rand() < 0.3) put(pick(RED_ADV), 2);
  let fen: string;
  try {
    const p = new Position();
    p.setup(b, 1);
    fen = toFen(p);
    parseFen(fen); // kiểm tra hợp lệ (vị trí quân, bên không đến lượt không bị chiếu)
    if (p.inCheck(1)) return null;
    return p;
  } catch {
    return null;
  }
}

interface Fixture {
  id: string;
  kind: 'm1' | 'm2' | 'm3' | 'd1';
  fen: string;
  /** Tất cả nước đúng (đã kiểm chứng). */
  solutions: string[];
  legalCount: number;
}

const want = { m1: 20, m2: 20, m3: 16, d1: 20 };
const out: Fixture[] = [];
const have = { m1: 0, m2: 0, m3: 0, d1: 0 };
let tries = 0;
while ((have.m1 < want.m1 || have.m2 < want.m2 || have.m3 < want.m3 || have.d1 < want.d1) && tries < 400000) {
  tries++;
  const p = randomPosition();
  if (!p) continue;
  const moves = p.legalMoves();
  if (moves.length < 8) continue;
  const fen = toFen(p);
  const m1 = moves.filter((m) => moveForcesWin(p, m, 1));
  if (m1.length > 0) {
    if (have.m1 < want.m1 && m1.length <= 2) {
      out.push({ id: `m1-${have.m1}`, kind: 'm1', fen, solutions: m1.map(moveToIccs), legalCount: moves.length });
      have.m1++;
    }
    // Biến thể phòng thủ: cho Đen đi trước ở vị trí này (nếu hợp lệ) — Đỏ dọa thắng 1 nước.
    if (have.d1 < want.d1) {
      try {
        const bfen = fen.replace(' w ', ' b ');
        parseFen(bfen);
        const q = new Position();
        const parsed = parseFen(bfen);
        q.setup(parsed.board, -1);
        const bm = q.legalMoves();
        if (bm.length >= 4) {
          const defs = bm.filter((m) => moveDefends(q, m, 1));
          if (defs.length > 0 && defs.length <= bm.length / 2) {
            out.push({ id: `d1-${have.d1}`, kind: 'd1', fen: bfen, solutions: defs.map(moveToIccs), legalCount: bm.length });
            have.d1++;
          }
        }
      } catch {
        /* bỏ qua */
      }
    }
    continue;
  }
  if (have.m2 < want.m2 || have.m3 < want.m3) {
    const m2 = moves.filter((m) => moveForcesWin(p, m, 2));
    if (m2.length > 0) {
      if (have.m2 < want.m2 && m2.length <= 2) {
        out.push({ id: `m2-${have.m2}`, kind: 'm2', fen, solutions: m2.map(moveToIccs), legalCount: moves.length });
        have.m2++;
      }
      continue;
    }
    if (have.m3 < want.m3 && moves.length <= 40 && canForceWin(p, 3)) {
      const m3 = moves.filter((m) => moveForcesWin(p, m, 3));
      if (m3.length <= 2) {
        out.push({ id: `m3-${have.m3}`, kind: 'm3', fen, solutions: m3.map(moveToIccs), legalCount: moves.length });
        have.m3++;
      }
    }
  }
}

mkdirSync(new URL('../test/fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('../test/fixtures/tactics.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`tries=${tries}`, have);
