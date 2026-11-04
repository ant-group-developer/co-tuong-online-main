import { describe, expect, it } from 'vitest';
import { Game, START_FEN, iccsToMove, moveToIccs, positionFromFen } from '../src/index.js';
import { AI_LEVELS, AI_PROFILES, Searcher, chooseMove, chooseMoveFromHistory } from '../src/ai/index.js';
import { moveDefends, moveForcesWin } from '../src/ai/mate-solver.js';
import tactics from './fixtures/tactics.json';

// Giới hạn thời gian trong unit test để CI nhanh; sức mạnh đầy đủ đo bằng `npm run bench:ai`.
const FAST = { maxTimeMs: 250 };

describe('AI – tính hợp lệ', () => {
  it.each(AI_LEVELS)('%s trả về nước hợp lệ từ khai cuộc và trung cuộc', (level) => {
    const g = new Game();
    for (let i = 0; i < 6 && !g.status.over; i++) {
      const d = chooseMove(g.position, level, { seed: 42 + i, limits: FAST });
      expect(g.isLegal(d.move)).toBe(true);
      g.play(d.move);
    }
  });

  it('mọi level đều có cấu hình riêng (không phải 6 tên cho cùng một bot)', () => {
    const sigs = new Set(AI_LEVELS.map((l) => JSON.stringify(AI_PROFILES[l])));
    expect(sigs.size).toBe(6);
    expect(AI_PROFILES.master.mistakes).toEqual({ randomMoveProb: 0, noiseCp: 0, blunderProb: 0, blunderMarginCp: 0 });
    expect(AI_PROFILES.super_easy.mistakes.randomMoveProb).toBeGreaterThan(0);
  });

  it('không đi tiếp khi ván đã kết thúc', () => {
    // Vị trí chiếu hết (Đen bị chiếu hết)
    const pos = positionFromFen('4k3R/R8/9/9/9/9/9/9/9/3K5 b - - 0 1');
    const d = chooseMove(pos, 'master', { limits: FAST });
    expect(d.move).toBe(0);
    expect(() => chooseMoveFromHistory('4k3R/R8/9/9/9/9/9/9/9/3K5 b - - 0 1', [], 'easy')).toThrow();
  });

  it('hủy được giữa chừng (shouldAbort) và vẫn trả nước hợp lệ từ vòng đã xong', () => {
    const pos = positionFromFen(START_FEN);
    let calls = 0;
    const t = performance.now();
    const d = chooseMove(pos, 'master', { shouldAbort: () => ++calls > 3 });
    expect(performance.now() - t).toBeLessThan(2000);
    expect(pos.isLegal(d.move)).toBe(true);
  });

  it('tìm kiếm không làm thay đổi vị trí gốc', () => {
    const g = new Game();
    g.play('h2e2');
    const h = g.stateHash();
    const fen = g.fen();
    chooseMove(g.position, 'hard', { limits: FAST });
    expect(g.stateHash()).toBe(h);
    expect(g.fen()).toBe(fen);
  });

  it('tôn trọng ngân sách thời gian', () => {
    const pos = positionFromFen(START_FEN);
    const r = new Searcher().search(pos, { ...AI_PROFILES.master.features, timeMs: 300 });
    expect(r.timeMs).toBeLessThan(900);
    expect(r.depth).toBeGreaterThanOrEqual(3);
  });
});

describe('AI – chiến thuật (fixture đã kiểm chứng bằng solver vét cạn)', () => {
  type Fx = { id: string; kind: string; fen: string; solutions: string[] };
  const fx = tactics as Fx[];

  it('fixture hợp lệ: mọi đáp án thực sự đúng', () => {
    for (const f of fx) {
      const pos = positionFromFen(f.fen);
      for (const s of f.solutions) {
        const m = iccsToMove(s);
        expect(pos.isLegal(m)).toBe(true);
        if (f.kind === 'd1') expect(moveDefends(pos, m, 1)).toBe(true);
        else expect(moveForcesWin(pos, m, Number(f.kind[1]))).toBe(true);
      }
    }
  });

  it('Khó trở lên giải mọi bài thắng trong 1 và phòng thủ 1 nước', () => {
    for (const f of fx.filter((x) => x.kind === 'm1' || x.kind === 'd1')) {
      const d = chooseMove(positionFromFen(f.fen), 'hard', { limits: FAST, seed: 1 });
      expect(f.solutions, f.id).toContain(moveToIccs(d.move));
    }
  });

  it('Master giải các bài thắng trong 2 nước', () => {
    for (const f of fx.filter((x) => x.kind === 'm2')) {
      const d = chooseMove(positionFromFen(f.fen), 'master', { limits: { maxTimeMs: 1000 } });
      const pos = positionFromFen(f.fen);
      // Chấp nhận mọi nước ép thắng trong ≤2 (solver kiểm chứng).
      expect(moveForcesWin(pos, d.move, 2), f.id).toBe(true);
    }
  });
});
