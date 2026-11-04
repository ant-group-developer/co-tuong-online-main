import { describe, expect, it } from 'vitest';
import {
  FenError,
  Game,
  IllegalMoveError,
  START_FEN,
  fromView,
  iccsToMove,
  iccsToSquare,
  moveToIccs,
  parseFen,
  positionFromFen,
  replayGame,
  replayMoves,
  serializeGame,
  toFen,
  toView,
} from '../src/index.js';
import { perft } from '../src/perft.js';

/** Danh sách đích (ICCS) hợp lệ của quân tại ô `from` (ICCS). */
function targets(fen: string, from: string): string[] {
  const g = new Game(fen);
  const sq = iccsToSquare(from);
  return g
    .legalTargets(sq)
    .map((t) => moveToIccs(sq | (t << 7)).slice(2))
    .sort();
}

describe('vị trí ban đầu & perft', () => {
  it('perft khớp giá trị chuẩn', () => {
    const p = positionFromFen(START_FEN);
    expect(perft(p, 1)).toBe(44);
    expect(perft(p, 2)).toBe(1920);
    expect(perft(p, 3)).toBe(79666);
  });

  it('FEN round-trip', () => {
    expect(toFen(positionFromFen(START_FEN))).toBe(START_FEN);
  });
});

describe('luật từng quân', () => {
  it('tướng chỉ đi 1 ô ngang/dọc trong cung', () => {
    // Tướng Đỏ ở d0 (góc cung); Tướng Đen f9 để không đối mặt.
    const fen = '5k3/9/9/p8/9/9/9/9/9/3K5 w - - 0 1';
    expect(targets(fen, 'd0')).toEqual(['d1', 'e0']);
  });

  it('tướng không được đi ra đường đối mặt với tướng địch (lộ mặt tướng)', () => {
    // Đen ở d9, Đỏ ở e0: Đỏ đi sang d0 sẽ đối mặt trên cột d => cấm.
    const fen = '3k5/9/9/p8/9/9/9/9/9/4K4 w - - 0 1';
    expect(targets(fen, 'e0')).toEqual(['e1', 'f0']);
  });

  it('quân chắn duy nhất giữa hai tướng không được rời cột', () => {
    // Mã Đỏ e5 là quân duy nhất giữa hai tướng trên cột e: mọi nước của mã đều làm lộ mặt tướng.
    const fen = '4k4/9/9/9/4N4/9/9/9/9/4K4 w - - 0 1';
    expect(targets(fen, 'e5')).toEqual([]);
  });

  it('sĩ chỉ đi chéo trong cung', () => {
    const fen = '5k3/9/9/p8/9/9/9/9/4A4/3K5 w - - 0 1';
    expect(targets(fen, 'e1')).toEqual(['d2', 'f0', 'f2']);
  });

  it('tượng đi chéo 2 ô, bị cản mắt, không qua sông', () => {
    const fen = '5k3/9/9/p8/9/2B6/9/9/9/3K5 w - - 0 1';
    // Tượng c4 (row5): có thể về a2, e2; không thể sang a6/e6 (qua sông).
    expect(targets(fen, 'c4')).toEqual(['a2', 'e2']);
    const blocked = '5k3/9/9/9/9/2B6/3p5/9/9/3K5 w - - 0 1';
    // Tốt Đen (đã qua sông) ở d3 cản mắt tượng hướng e2.
    expect(targets(blocked, 'c4')).toEqual(['a2']);
  });

  it('mã bị cản chân', () => {
    const fen = '5k3/9/9/9/9/9/9/9/9/1N1K5 w - - 0 1';
    expect(targets(fen, 'b0')).toEqual(['a2', 'c2', 'd1']);
    const blocked2 = '5k3/9/9/9/9/9/9/9/1R7/1N1K5 w - - 0 1';
    expect(targets(blocked2, 'b0')).toEqual(['d1']);
  });

  it('xe đi thẳng, bị chặn, ăn quân địch đầu tiên', () => {
    const fen = '5k3/9/9/9/9/p8/9/9/9/R2K5 w - - 0 1';
    // Xe a0: lên a1..a4 (a4 có tốt Đen => ăn), sang b0, c0 (d0 là tướng mình).
    expect(targets(fen, 'a0')).toEqual(['a1', 'a2', 'a3', 'a4', 'b0', 'c0']);
  });

  it('pháo: đi như xe khi không ăn, ăn phải qua đúng một ngòi', () => {
    // Pháo Đỏ a0; ngòi a3 (tốt Đỏ), tốt Đen a6 => ăn được a6; a9 (xe Đen) bị 2 ngòi.
    const fen = 'r4k3/9/9/p8/9/9/P8/9/9/C2K5 w - - 0 1';
    expect(targets(fen, 'a0')).toEqual(['a1', 'a2', 'a6', 'b0', 'c0']);
  });

  it('tốt chưa qua sông chỉ tiến; qua sông được đi ngang; không lùi', () => {
    const before = '5k3/9/9/9/9/9/4P4/9/9/3K5 w - - 0 1';
    expect(targets(before, 'e3')).toEqual(['e4']);
    const after = '5k3/9/9/9/4P4/9/9/9/9/3K5 w - - 0 1';
    expect(targets(after, 'e5')).toEqual(['d5', 'e6', 'f5']);
    const black = '5k3/9/9/9/9/4p4/9/9/9/3K5 b - - 0 1';
    expect(targets(black, 'e4')).toEqual(['d4', 'e3', 'f4']);
  });

  it('không ăn quân cùng màu, không đi từ ô trống, không đi sai lượt', () => {
    const g = new Game();
    expect(() => g.play('a0a3')).toThrow(IllegalMoveError); // xe ra a3 bị tốt mình chặn
    expect(() => g.play('e5e6')).toThrow(IllegalMoveError); // ô trống
    expect(() => g.play('h7e7')).toThrow(IllegalMoveError); // pháo Đen, sai lượt
    expect(g.ply).toBe(0);
  });
});

describe('chiếu, tự chiếu, thoát chiếu', () => {
  it('quân bị ghim không được đi làm lộ tướng', () => {
    // Xe Đen e9 ghim mã Đỏ e2 vào tướng Đỏ e0.
    const fen = '3kr4/9/9/9/9/9/9/4N4/9/4K4 w - - 0 1';
    expect(targets(fen, 'e2')).toEqual([]);
  });

  it('khi bị chiếu chỉ được đi nước thoát chiếu', () => {
    // Xe Đen e9 chiếu tướng Đỏ e0; xe Đỏ a5 có thể chặn ở e5? không cùng hàng => chỉ tướng né.
    const fen = '3kr4/9/9/9/9/9/9/9/R8/4K4 w - - 0 1';
    const g = new Game(fen);
    expect(g.status.inCheck).toBe(true);
    const moves = g.legalMoves().map(moveToIccs).sort();
    // Xe a1 chắn e1, hoặc tướng sang d0/f0 (d0 không đối mặt vì tướng Đen d9? => có! d9 đen ở cột d)
    expect(moves).toContain('a1e1');
    expect(moves).toContain('e0f0');
    expect(moves).not.toContain('e0d0'); // đối mặt tướng Đen d9
    expect(moves).not.toContain('e0e1'); // vẫn trên cột xe
  });

  it('chiếu hết => bên bị chiếu thua', () => {
    const g = new Game('4k3R/R8/9/9/9/9/9/9/9/3K5 b - - 0 1');
    expect(g.status).toMatchObject({ over: true, result: 'red', reason: 'checkmate', inCheck: true });
    expect(g.legalMoves()).toEqual([]);
    expect(() => g.play('e9e8')).toThrow(IllegalMoveError);
  });

  it('hết nước đi (không bị chiếu) => thua, không phải hòa pat', () => {
    const g = new Game('3k5/R8/9/9/9/9/9/9/9/4K4 b - - 0 1');
    expect(g.status).toMatchObject({ over: true, result: 'red', reason: 'no_legal_moves', inCheck: false });
  });

  it('phát hiện chiếu sau nước đi (pháo đầu)', () => {
    const g = new Game();
    g.play('h2e2');
    g.play('h9g7');
    const rec = g.play('e2e6'); // pháo đầu ăn tốt giữa qua ngòi là tốt Đỏ e3
    expect(rec.captured).not.toBe(0);
    expect(rec.givesCheck).toBe(false); // giữa e6 và tướng e9 không có ngòi => chưa chiếu
  });
});

describe('lặp lại / không tiến triển / thiếu quân', () => {
  it('trường chiếu: bên chiếu liên tục bị xử thua khi lặp lần 3', () => {
    const g = new Game('4k4/R8/9/9/9/9/9/9/9/3K5 w - - 0 1');
    const cycle = ['a8a9', 'e9e8', 'a9a8', 'e8e9'];
    for (const m of [...cycle, ...cycle.slice(0, 3)]) {
      g.play(m);
      expect(g.status.over).toBe(false);
    }
    g.play('e8e9');
    expect(g.status).toMatchObject({ over: true, result: 'black', reason: 'perpetual_check' });
  });

  it('lặp lại không có chiếu => hòa', () => {
    const g = new Game('5k2r/9/9/9/9/9/9/9/9/R2K5 w - - 0 1');
    const cycle = ['a0a1', 'i9i8', 'a1a0', 'i8i9'];
    for (const m of [...cycle, ...cycle]) g.play(m);
    expect(g.status).toMatchObject({ over: true, result: 'draw', reason: 'repetition' });
  });

  it('120 nửa nước không ăn quân => hòa', () => {
    const g = new Game('5k2r/9/9/9/9/9/9/9/9/R2K5 w - - 118 80');
    g.play('a0a1');
    expect(g.status.over).toBe(false);
    g.play('i9i8');
    expect(g.status).toMatchObject({ over: true, result: 'draw', reason: 'no_progress' });
  });

  it('không còn quân tấn công => hòa', () => {
    const g = new Game('3ak4/4a4/9/9/9/9/9/9/4A4/3AK4 w - - 0 1');
    expect(g.status).toMatchObject({ over: true, result: 'draw', reason: 'insufficient_material' });
  });

  it('không sinh nước sau khi kết thúc', () => {
    const g = new Game('3ak4/4a4/9/9/9/9/9/9/4A4/3AK4 w - - 0 1');
    expect(g.legalMoves()).toEqual([]);
    expect(() => g.play('d0e1')).toThrow(/kết thúc/);
  });
});

describe('FEN & input sai', () => {
  it.each([
    ['', 'rỗng'],
    ['rnbakabnr/9/1c5c1 w', 'thiếu hàng'],
    ['rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNX w - - 0 1', 'ký tự lạ'],
    ['rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBA1ABNR w - - 0 1', 'thiếu tướng Đỏ'],
    ['4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1', 'tướng đối mặt (bên không đến lượt bị chiếu)'],
    ['4k4/9/9/9/9/9/9/9/4K4/9 w - - 0 1', 'tướng ở e1 vẫn đối mặt'],
    ['3k5/9/9/9/9/9/9/9/9/K8 w - - 0 1', 'tướng ngoài cung'],
    ['3k5/9/9/9/9/9/9/9/9/4KP3 w - - 0 1', 'tốt ở hàng cuối của mình'],
  ])('từ chối FEN không hợp lệ: %s (%s)', (fen) => {
    expect(() => parseFen(fen)).toThrow(FenError);
  });

  it('nước đi sai định dạng bị từ chối an toàn', () => {
    const g = new Game();
    for (const bad of ['', 'z9z9', 'a0', 'a0a0', 'a10a1', '<script>', 'h2e2x']) {
      expect(() => g.play(bad)).toThrow(IllegalMoveError);
    }
    expect(() => g.play(-5 as unknown as number)).toThrow(IllegalMoveError);
    expect(() => g.play(1e9)).toThrow(IllegalMoveError);
    expect(g.ply).toBe(0);
    expect(iccsToMove('j0a0')).toBe(-1);
  });
});

describe('serialize / replay / view', () => {
  function randomGame(seed: number, plies: number): Game {
    let s = seed;
    const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const g = new Game();
    for (let i = 0; i < plies && !g.status.over; i++) {
      const moves = g.legalMoves();
      g.play(moves[Math.floor(rand() * moves.length)]);
    }
    return g;
  }

  it('replay tái tạo đúng vị trí, hash và kết quả', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = randomGame(seed, 150);
      const data = JSON.parse(JSON.stringify(serializeGame(g)));
      const r = replayGame(data);
      expect(r.fen()).toBe(g.fen());
      expect(r.stateHash()).toBe(g.stateHash());
      expect(r.status).toEqual(g.status);
      const r2 = replayMoves(g.startFen, g.movesIccs().join(' '));
      expect(r2.stateHash()).toBe(g.stateHash());
    }
  });

  it('replay từ chối dữ liệu bị sửa', () => {
    const g = randomGame(7, 20);
    const data = serializeGame(g);
    expect(() => replayGame({ ...data, v: 2 })).toThrow();
    expect(() => replayGame({ ...data, rules: 'other' })).toThrow();
    expect(() => replayGame({ ...data, moves: [...data.moves.slice(0, 5), 'a0a9'] })).toThrow();
  });

  it('make/unmake khôi phục hash và bàn; hash tăng dần = hash dựng lại', () => {
    for (let seed = 30; seed < 40; seed++) {
      const g = randomGame(seed, 80);
      const fresh = positionFromFen(g.fen());
      expect(fresh.hashHex()).toBe(g.stateHash());
      const before = g.stateHash();
      const fenBefore = g.fen();
      for (const m of g.legalMoves()) {
        g.position.make(m);
        expect(g.position.inCheck(g.position.side === 1 ? -1 : 1)).toBe(false); // nước hợp lệ không để tướng mình bị chiếu
        g.position.unmake();
      }
      expect(g.stateHash()).toBe(before);
      expect(g.fen()).toBe(fenBefore);
    }
  });

  it('ván ngẫu nhiên luôn kết thúc trong giới hạn', () => {
    const g = randomGame(99, 1000);
    expect(g.status.over).toBe(true);
  });

  it('lật bàn chỉ đổi hiển thị, không đổi state hash', () => {
    const g = randomGame(3, 30);
    const h = g.stateHash();
    for (let sq = 0; sq < 90; sq++) {
      for (const flipped of [false, true]) {
        const v = toView(sq, flipped);
        expect(fromView(v.row, v.col, flipped)).toBe(sq);
      }
    }
    expect(toView(iccsToSquare('a0'), true)).toEqual({ row: 0, col: 8 });
    expect(g.stateHash()).toBe(h);
  });
});

describe('ký hiệu Việt', () => {
  it('ghi đúng các nước khai cuộc phổ biến', () => {
    const g = new Game();
    expect(g.play('h2e2').vn).toBe('P2-5');
    expect(g.play('h9g7').vn).toBe('M8.7');
    expect(g.play('h0g2').vn).toBe('M2.3');
    expect(g.play('i9h9').vn).toBe('X9-8');
    expect(g.play('i0h0').vn).toBe('X1-2');
  });
});
