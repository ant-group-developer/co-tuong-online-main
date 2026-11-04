import { describe, expect, it } from 'vitest';
import { applyCommand, applyTimeoutCheck, createMatchDoc, validateCommand } from '../../functions/src/core/match-core';
import { MATCH_POLICY } from '../../functions/src/config';
import type { MatchCommand, MatchDoc } from '../../functions/src/core/types';

const RED = 'uid_red';
const BLACK = 'uid_black';
const T0 = 1_700_000_000_000;
let seq = 0;
const cid = () => `cmd_${(++seq).toString().padStart(6, '0')}`;

function newMatch(mode: 'ranked' | 'friendly' = 'ranked'): MatchDoc {
  return createMatchDoc({
    matchId: 'match00001',
    roomId: 'room0001',
    mode,
    rated: mode === 'ranked',
    visibility: 'public',
    players: { red: { uid: RED, name: 'Đỏ' }, black: { uid: BLACK, name: 'Đen' } },
    initialMs: 5 * 60_000,
    incrementMs: 2_000,
    now: T0,
  });
}

function move(m: MatchDoc, uid: string, iccs: string, now: number, opts: Partial<MatchCommand> = {}) {
  return applyCommand(
    m,
    { type: 'move', commandId: cid(), expectedVersion: m.state.v, from: iccs.slice(0, 2), to: iccs.slice(2), ...opts },
    { uid, now },
  );
}

/** Đi một chuỗi nước, mỗi nước cách nhau `gap` ms. */
function play(m: MatchDoc, moves: string[], start = T0, gap = 1000): { m: MatchDoc; now: number } {
  let cur = m;
  let now = start;
  for (const mv of moves) {
    now += gap;
    const uid = cur.state.turn === 'red' ? RED : BLACK;
    const r = move(cur, uid, mv, now);
    expect(r.ok, `${mv}: ${r.code}`).toBe(true);
    cur = r.match;
  }
  return { m: cur, now };
}

describe('submitMove – xác thực', () => {
  it('chấp nhận nước hợp lệ, tăng version, cập nhật FEN/hash/nước cuối', () => {
    const m = newMatch();
    const r = move(m, RED, 'h2e2', T0 + 500);
    expect(r).toMatchObject({ commit: true, ok: true, code: 'ok' });
    expect(r.match.state.v).toBe(2);
    expect(r.match.state.moves).toBe('h2e2');
    expect(r.match.state.turn).toBe('black');
    expect(r.match.state.lastMove).toBe('h2e2');
    expect(m.state.v).toBe(1); // không mutate input (callback transaction có thể chạy lại)
  });

  it('từ chối: sai lượt, không phải người chơi, nước sai luật, version cũ', () => {
    const m = newMatch();
    expect(move(m, BLACK, 'h7e7', T0 + 1).code).toBe('not_your_turn');
    expect(move(m, 'stranger', 'h2e2', T0 + 1).code).toBe('not_player');
    expect(move(m, RED, 'h2h8', T0 + 1).code).toBe('illegal_move');
    expect(move(m, RED, 'h2e2', T0 + 1, { expectedVersion: 0 }).code).toBe('stale_version');
    for (const r of [move(m, RED, 'h2h8', T0 + 1)]) expect(r.commit).toBe(false);
  });

  it('payload sai định dạng bị validateCommand chặn', () => {
    expect(validateCommand(null)).toBeNull();
    expect(validateCommand({ type: 'move', commandId: 'short', expectedVersion: 1, from: 'a0', to: 'a1' })).toBeNull();
    expect(validateCommand({ type: 'move', commandId: 'abcdefgh12', expectedVersion: 1, from: 'z0', to: 'a1' })).toBeNull();
    expect(validateCommand({ type: 'move', commandId: 'abcdefgh12', expectedVersion: -1, from: 'a0', to: 'a1' })).toBeNull();
    expect(validateCommand({ type: 'hack', commandId: 'abcdefgh12', expectedVersion: 1 })).toBeNull();
    expect(validateCommand({ type: 'respondDraw', commandId: 'abcdefgh12', expectedVersion: 1 })).toBeNull();
    expect(validateCommand({ type: 'move', commandId: 'abcdefgh12', expectedVersion: 1, from: 'a0', to: 'a1', board: 'x' })).not.toHaveProperty('board');
  });
});

describe('idempotency & tranh chấp', () => {
  it('gửi lại cùng commandId sau khi mất ACK => trả kết quả cũ, không áp dụng hai lần', () => {
    const m = newMatch();
    const cmd: MatchCommand = { type: 'move', commandId: 'retry_cmd_01', expectedVersion: 1, from: 'h2', to: 'e2' };
    const first = applyCommand(m, cmd, { uid: RED, now: T0 + 10 });
    expect(first.ok).toBe(true);
    const again = applyCommand(first.match, cmd, { uid: RED, now: T0 + 20 });
    expect(again).toMatchObject({ commit: false, ok: true, code: 'duplicate' });
    expect(first.match.state.v).toBe(2);
  });

  it('commandId của người khác không được tái sử dụng', () => {
    const m = newMatch();
    const r = applyCommand(m, { type: 'move', commandId: 'shared_cmd_1', expectedVersion: 1, from: 'h2', to: 'e2' }, { uid: RED, now: T0 + 1 });
    const steal = applyCommand(r.match, { type: 'resign', commandId: 'shared_cmd_1', expectedVersion: 2 }, { uid: BLACK, now: T0 + 2 });
    expect(steal.code).toBe('bad_request');
  });

  it('hai lệnh cùng expectedVersion (hai tab cùng UID): chỉ một lệnh thắng, lệnh kia stale', () => {
    const m = newMatch();
    const a = move(m, RED, 'h2e2', T0 + 10);
    // Transaction chạy lại với giá trị mới nhất (sau a) => b bị từ chối
    const b = applyCommand(a.match, { type: 'move', commandId: cid(), expectedVersion: 1, from: 'b2', to: 'e2' }, { uid: RED, now: T0 + 11 });
    expect(a.ok).toBe(true);
    expect(b.code).toBe('stale_version');
  });

  it('đầu hàng vs nước đi đồng thời: lệnh nào commit trước quyết định; lệnh sau bị game_over', () => {
    const { m } = play(newMatch(), ['h2e2', 'h9g7']);
    const resign = applyCommand(m, { type: 'resign', commandId: cid(), expectedVersion: m.state.v }, { uid: BLACK, now: T0 + 5000 });
    expect(resign.match.state.result).toMatchObject({ winner: 'red', reason: 'resign' });
    expect(resign.match.outbox?.status).toBe('pending');
    const lateMove = move(resign.match, RED, 'h0g2', T0 + 5001);
    expect(lateMove.code).toBe('game_over');
    expect(lateMove.commit).toBe(false);
  });

  it('nước đi tới sau deadline => kết thúc do hết giờ, không áp dụng nước', () => {
    const { m, now } = play(newMatch(), ['h2e2', 'h9g7']);
    const late = now + m.state.clock.red + MATCH_POLICY.moveGraceMs + 1;
    const r = move(m, RED, 'h0g2', late);
    expect(r).toMatchObject({ commit: true, ok: false, code: 'timeout', finished: true });
    expect(r.match.state.result).toMatchObject({ winner: 'black', reason: 'timeout' });
    expect(r.match.state.moves).toBe('h2e2 h9g7');
    expect(r.match.state.clock.red).toBe(0);
  });

  it('task hết giờ cũ (version đã đổi) bị bỏ qua; task đúng version kết thúc trận', () => {
    const { m, now } = play(newMatch(), ['h2e2', 'h9g7', 'h0g2']);
    const staleTask = applyTimeoutCheck(m, now + 10 * 60_000, m.state.v - 1);
    expect(staleTask.code).toBe('stale_version');
    expect(applyTimeoutCheck(m, now + 1000, m.state.v).code).toBe('not_expired');
    const ok = applyTimeoutCheck(m, now + 10 * 60_000, m.state.v);
    expect(ok.match.state.result).toMatchObject({ winner: 'red', reason: 'timeout' });
    // Kết quả chỉ ghi một lần
    expect(applyTimeoutCheck(ok.match, now + 11 * 60_000).code).toBe('game_over');
  });

  it('cả hai offline: sweep không cần client vẫn kết thúc đúng chính sách (hủy nếu chưa đủ 2 nước)', () => {
    const m = newMatch();
    const r = applyTimeoutCheck(m, T0 + MATCH_POLICY.firstMoveMs + MATCH_POLICY.moveGraceMs + 1);
    expect(r.match.state.status).toBe('aborted');
    expect(r.match.state.result?.reason).toBe('aborted');
  });

  it('đồng hồ: trừ thời gian đã dùng + cộng increment; hai nước đầu không trừ giờ', () => {
    const m0 = newMatch();
    const a = move(m0, RED, 'h2e2', T0 + 20_000).match;
    expect(a.state.clock.red).toBe(5 * 60_000);
    const b = move(a, BLACK, 'h9g7', T0 + 40_000).match;
    const c = move(b, RED, 'h0g2', T0 + 47_000).match; // dùng 7s, +2s
    expect(c.state.clock.red).toBe(5 * 60_000 - 7_000 + 2_000);
    expect(c.state.deadline).toBe(c.state.clock.turnStartedAt + c.state.clock.black + MATCH_POLICY.moveGraceMs);
  });

  it('hết giờ khi bên thắng không còn quân tấn công => hòa', () => {
    // Đỏ chỉ còn tướng + sĩ; Đen còn xe. Đen hết giờ => hòa (Đỏ không thể chiếu hết).
    const m = createMatchDoc({
      matchId: 'match00002',
      roomId: 'room0001',
      mode: 'ranked',
      rated: true,
      visibility: 'public',
      players: { red: { uid: RED, name: 'Đỏ' }, black: { uid: BLACK, name: 'Đen' } },
      initialMs: 60_000,
      incrementMs: 0,
      now: T0,
      startFen: '3k5/9/9/9/9/9/r8/9/4A4/4K4 w - - 0 1',
    });
    const s1 = move(m, RED, 'e1d2', T0 + 100).match;
    const s2 = move(s1, BLACK, 'a3a4', T0 + 200).match;
    const s3 = move(s2, RED, 'd2e1', T0 + 300).match;
    const r = applyTimeoutCheck(s3, T0 + 300 + 60_000 + MATCH_POLICY.moveGraceMs + 5);
    expect(r.match.state.result).toMatchObject({ winner: 'draw', reason: 'timeout' });
  });
});

describe('hòa, đi lại, bỏ trận', () => {
  it('cầu hòa: đối thủ chấp nhận => hòa; nước đi hủy lời cầu hòa', () => {
    const { m, now } = play(newMatch(), ['h2e2', 'h9g7']);
    const offer = applyCommand(m, { type: 'offerDraw', commandId: cid(), expectedVersion: m.state.v }, { uid: RED, now: now + 1 });
    expect(offer.match.state.drawOffer).toBe('red');
    // Người cầu hòa không tự chấp nhận
    const self = applyCommand(offer.match, { type: 'respondDraw', commandId: cid(), expectedVersion: 0, accept: true }, { uid: RED, now: now + 2 });
    expect(self.code).toBe('no_offer');
    const accept = applyCommand(offer.match, { type: 'respondDraw', commandId: cid(), expectedVersion: 0, accept: true }, { uid: BLACK, now: now + 3 });
    expect(accept.match.state.result).toMatchObject({ winner: 'draw', reason: 'draw_agreement' });

    const moved = move(offer.match, RED, 'h0g2', now + 4).match;
    expect(moved.state.drawOffer).toBeNull();
    const tooLate = applyCommand(moved, { type: 'respondDraw', commandId: cid(), expectedVersion: 0, accept: true }, { uid: BLACK, now: now + 5 });
    expect(tooLate.code).toBe('no_offer');
  });

  it('đi lại chỉ cho phòng bạn bè, cần đối thủ đồng ý', () => {
    const ranked = play(newMatch('ranked'), ['h2e2', 'h9g7']).m;
    expect(applyCommand(ranked, { type: 'requestUndo', commandId: cid(), expectedVersion: ranked.state.v }, { uid: BLACK, now: T0 + 9000 }).code).toBe(
      'not_allowed',
    );
    const { m, now } = play(newMatch('friendly'), ['h2e2', 'h9g7']);
    const req = applyCommand(m, { type: 'requestUndo', commandId: cid(), expectedVersion: m.state.v }, { uid: BLACK, now: now + 1 });
    expect(req.match.state.undoRequest).toBe('black');
    const ok = applyCommand(req.match, { type: 'respondUndo', commandId: cid(), expectedVersion: 0, accept: true }, { uid: RED, now: now + 2 });
    expect(ok.match.state.moves).toBe('h2e2');
    expect(ok.match.state.turn).toBe('black');
  });

  it('xử thắng do bỏ trận chỉ khi đối thủ offline đủ lâu', () => {
    const { m, now } = play(newMatch(), ['h2e2', 'h9g7']);
    const early = applyCommand(m, { type: 'claimAbandon', commandId: cid(), expectedVersion: 0 }, { uid: RED, now, opponentOfflineSince: now - 10_000 });
    expect(early.code).toBe('not_expired');
    const online = applyCommand(m, { type: 'claimAbandon', commandId: cid(), expectedVersion: 0 }, { uid: RED, now, opponentOfflineSince: null });
    expect(online.code).toBe('not_expired');
    const late = applyCommand(
      m,
      { type: 'claimAbandon', commandId: cid(), expectedVersion: 0 },
      { uid: RED, now, opponentOfflineSince: now - MATCH_POLICY.abandonAfterMs - 1 },
    );
    expect(late.match.state.result).toMatchObject({ winner: 'red', reason: 'abandon' });
  });

  it('chiếu hết qua submitMove kết thúc trận và tạo outbox', () => {
    const m = createMatchDoc({
      matchId: 'match00003',
      roomId: 'room0001',
      mode: 'ranked',
      rated: true,
      visibility: 'public',
      players: { red: { uid: RED, name: 'Đỏ' }, black: { uid: BLACK, name: 'Đen' } },
      initialMs: 60_000,
      incrementMs: 0,
      now: T0,
      startFen: '4k4/R8/9/9/9/9/8R/9/9/3K5 w - - 0 1',
    });
    const r = move(m, RED, 'i3i9', T0 + 10);
    expect(r.finished).toBe(true);
    expect(r.match.state.result).toMatchObject({ winner: 'red', reason: 'checkmate' });
    expect(r.match.state.deadline).toBeNull();
    expect(r.match.outbox).toMatchObject({ status: 'pending' });
  });
});
