import { positionFromFen, START_FEN } from '../src/index.js';
import { perft } from '../src/perft.js';

const fen = process.argv[2] ?? START_FEN;
const maxDepth = Number(process.argv[3] ?? 4);
const pos = positionFromFen(fen);
for (let d = 1; d <= maxDepth; d++) {
  const t = performance.now();
  const n = perft(pos, d);
  console.log(`perft(${d}) = ${n}  (${(performance.now() - t).toFixed(0)} ms)`);
}
