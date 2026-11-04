/**
 * Benchmark AI: (1) tactical suite đã kiểm chứng, (2) đấu chéo giữa các profile với NGÂN SÁCH THẬT.
 * Mỗi cặp đấu chạy trong một tiến trình con riêng (song song) để tiết kiệm thời gian tổng.
 *
 *   npx tsx scripts/benchmark.ts                # chạy tất cả, ghi docs/ai-benchmark.json
 *   npx tsx scripts/benchmark.ts --games 6      # số ván mỗi cặp (đổi màu luân phiên)
 *   npx tsx scripts/benchmark.ts --tactics-only
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Game, moveToIccs, positionFromFen } from '../src/index.js';
import { AI_LEVELS, AI_PROFILES, Searcher, chooseMove, type AiLevel } from '../src/ai/index.js';
import { moveDefends, moveForcesWin } from '../src/ai/mate-solver.js';
import tactics from '../test/fixtures/tactics.json' with { type: 'json' };

const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

const OPENINGS: string[][] = [
  [],
  ['h2e2', 'h9g7'],
  ['b2e2', 'b9c7'],
  ['c3c4', 'g6g5'],
  ['h0g2', 'h7e7'],
  ['g3g4', 'c6c5'],
];
const BENCH_MAX_PLIES = 300;

interface GameOutcome {
  red: AiLevel;
  black: AiLevel;
  opening: number;
  result: 'red' | 'black' | 'draw';
  reason: string;
  plies: number;
  think: Record<string, { totalMs: number; moves: number; depthSum: number; nodes: number }>;
}

function playGame(red: AiLevel, black: AiLevel, opening: number, seed: number): GameOutcome {
  const g = new Game();
  for (const m of OPENINGS[opening]) g.play(m);
  const searchers = { red: new Searcher(), black: new Searcher() };
  const think: GameOutcome['think'] = {
    red: { totalMs: 0, moves: 0, depthSum: 0, nodes: 0 },
    black: { totalMs: 0, moves: 0, depthSum: 0, nodes: 0 },
  };
  let s = seed;
  while (!g.status.over && g.ply < BENCH_MAX_PLIES) {
    const side = g.sideToMove;
    const level = side === 'red' ? red : black;
    const t = performance.now();
    const d = chooseMove(g.position, level, { seed: s++, searcher: searchers[side] });
    think[side].totalMs += performance.now() - t;
    think[side].moves++;
    think[side].depthSum += d.search.depth;
    think[side].nodes += d.search.nodes;
    g.play(d.move);
  }
  const st = g.status;
  return {
    red,
    black,
    opening,
    result: st.over ? st.result! : 'draw',
    reason: st.over ? st.reason! : 'bench_ply_cap',
    plies: g.ply,
    think,
  };
}

function runTactics() {
  type Fx = { id: string; kind: 'm1' | 'm2' | 'm3' | 'd1'; fen: string; solutions: string[] };
  const fx = tactics as Fx[];
  const kinds = ['m1', 'd1', 'm2', 'm3'] as const;
  const table: Record<string, Record<string, { solved: number; total: number; avgMs: number }>> = {};
  for (const level of AI_LEVELS) {
    table[level] = {};
    for (const k of kinds) {
      const set = fx.filter((f) => f.kind === k);
      let solved = 0;
      let ms = 0;
      set.forEach((f, i) => {
        const pos = positionFromFen(f.fen);
        const t = performance.now();
        const d = chooseMove(pos, level, { seed: 1000 + i });
        ms += performance.now() - t;
        const ok =
          k === 'd1' ? moveDefends(pos, d.move, 1) : moveForcesWin(pos, d.move, Number(k[1]));
        if (ok) solved++;
        void moveToIccs;
      });
      table[level][k] = { solved, total: set.length, avgMs: Math.round(ms / set.length) };
    }
    console.log(level, JSON.stringify(table[level]));
  }
  return table;
}

async function runMatches(games: number) {
  const pairs: Array<[AiLevel, AiLevel]> = [
    ['super_easy', 'easy'],
    ['easy', 'medium'],
    ['medium', 'hard'],
    ['hard', 'super_hard'],
    ['super_hard', 'master'],
    ['medium', 'master'],
  ];
  const jobs: Array<{ a: AiLevel; b: AiLevel; i: number }> = [];
  for (const [a, b] of pairs) for (let i = 0; i < games; i++) jobs.push({ a, b, i });
  const self = fileURLToPath(import.meta.url);
  // Dùng ~số nhân vật lý - 1 để hạn chế tranh chấp CPU làm méo ngân sách thời gian.
  const concurrency = Math.max(1, Math.min(Math.floor(os.cpus().length / 2) - 1, 8));
  const results: GameOutcome[] = [];
  let next = 0;
  const runOne = (job: (typeof jobs)[number]) =>
    new Promise<GameOutcome>((resolve, reject) => {
      // Ván chẵn: a cầm Đỏ; ván lẻ: đổi màu.
      const red = job.i % 2 === 0 ? job.a : job.b;
      const black = job.i % 2 === 0 ? job.b : job.a;
      const opening = Math.floor(job.i / 2) % OPENINGS.length;
      const child = spawn(process.execPath, ['--import', 'tsx', self, '--child', red, black, String(opening), String(job.i * 7919 + 1)], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let out = '';
      child.stdout.on('data', (c) => (out += c));
      child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`child exit ${code}`))));
    });
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const r = await runOne(job);
        results.push(r);
        console.log(`${r.red} vs ${r.black} [op ${r.opening}] => ${r.result} (${r.reason}, ${r.plies} plies)`);
      }
    }),
  );
  // Tổng hợp theo cặp (góc nhìn level "a")
  const summary = pairs.map(([a, b]) => {
    const rs = results.filter((r) => (r.red === a && r.black === b) || (r.red === b && r.black === a));
    let aw = 0;
    let bw = 0;
    let dr = 0;
    const think: Record<string, { ms: number; moves: number; depth: number }> = {
      [a]: { ms: 0, moves: 0, depth: 0 },
      [b]: { ms: 0, moves: 0, depth: 0 },
    };
    for (const r of rs) {
      const winner = r.result === 'draw' ? null : r.result === 'red' ? r.red : r.black;
      if (winner === a) aw++;
      else if (winner === b) bw++;
      else dr++;
      for (const side of ['red', 'black'] as const) {
        const lv = side === 'red' ? r.red : r.black;
        think[lv].ms += r.think[side].totalMs;
        think[lv].moves += r.think[side].moves;
        think[lv].depth += r.think[side].depthSum;
      }
    }
    return {
      pair: `${a} vs ${b}`,
      games: rs.length,
      [`${a}_wins`]: aw,
      [`${b}_wins`]: bw,
      draws: dr,
      [`${b}_score_pct`]: rs.length ? Math.round(((bw + dr / 2) / rs.length) * 1000) / 10 : 0,
      avgThinkMs: { [a]: Math.round(think[a].ms / Math.max(1, think[a].moves)), [b]: Math.round(think[b].ms / Math.max(1, think[b].moves)) },
      avgDepth: {
        [a]: Math.round((think[a].depth / Math.max(1, think[a].moves)) * 10) / 10,
        [b]: Math.round((think[b].depth / Math.max(1, think[b].moves)) * 10) / 10,
      },
      reasons: rs.map((r) => r.reason),
    };
  });
  return { summary, games: results };
}

async function main() {
  if (args[0] === '--child') {
    const [, red, black, opening, seed] = args;
    const r = playGame(red as AiLevel, black as AiLevel, Number(opening), Number(seed));
    process.stdout.write(JSON.stringify(r));
    return;
  }
  const meta = {
    date: new Date().toISOString(),
    engine: 'xq-engine (tự viết) – alpha-beta/PVS + TT + quiescence + null-move + LMR',
    node: process.version,
    cpu: os.cpus()[0].model,
    cores: os.cpus().length,
    memGB: Math.round(os.totalmem() / 1e9),
    note: 'Mỗi ván chạy trong một tiến trình riêng; nhiều ván chạy song song nên thời gian/nước có thể cao hơn khi máy rảnh.',
    profiles: Object.fromEntries(AI_LEVELS.map((l) => [l, { ...AI_PROFILES[l].features, mistakes: AI_PROFILES[l].mistakes }])),
  };
  console.log('== Tactical suite ==');
  const tacticsTable = runTactics();
  let matches: Awaited<ReturnType<typeof runMatches>> | null = null;
  if (!args.includes('--tactics-only')) {
    console.log('== Đấu chéo ==');
    matches = await runMatches(Number(arg('--games', '6')));
  }
  const outPath = arg('--out', fileURLToPath(new URL('../../../docs/ai-benchmark.json', import.meta.url)));
  writeFileSync(outPath, JSON.stringify({ meta, tactics: tacticsTable, matches: matches?.summary, games: matches?.games }, null, 2));
  console.log('Đã ghi', outPath);
  if (matches) console.table(matches.summary.map(({ reasons: _r, ...rest }) => rest));
}

void main();
