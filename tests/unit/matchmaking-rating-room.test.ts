import { describe, expect, it } from 'vitest';
import { mmCancel, mmEnqueue, ratingWindow, type MmState } from '../../functions/src/core/matchmaking-core';
import { applyOutcome, defaultStats, eloUpdate, winRate } from '../../functions/src/core/rating';
import {
  joinAsPlayer,
  kickGuest,
  leaveRoom,
  newRankedRoom,
  newRoom,
  requestRematch,
  setReady,
  updateSettings,
} from '../../functions/src/core/room-core';

let n = 0;
const ids = () => ({ roomId: `room${++n}`, matchId: `match${n}` });

describe('matchmaking', () => {
  it('ghép hai người cùng time control, gần rating; không tự ghép', () => {
    let st: MmState | null = null;
    const a = mmEnqueue(st, { uid: 'a', name: 'A', rating: 1200, tc: '5+0' }, 1000, ids);
    expect(a.status).toBe('queued');
    st = a.state;
    const again = mmEnqueue(st, { uid: 'a', name: 'A', rating: 1200, tc: '5+0' }, 2000, ids);
    expect(again.status).toBe('queued'); // enqueue trùng không tạo mục thứ hai, không tự ghép
    expect(Object.keys(again.state.queue!)).toEqual(['a']);
    st = again.state;
    const other = mmEnqueue(st, { uid: 'c', name: 'C', rating: 1250, tc: '10+5' }, 2500, ids);
    expect(other.status).toBe('queued'); // khác time control
    st = other.state;
    const b = mmEnqueue(st, { uid: 'b', name: 'B', rating: 1250, tc: '5+0' }, 3000, ids);
    expect(b.status).toBe('matched');
    expect(b.newPair?.b.uid).toBe('a');
    expect(b.state.active).toMatchObject({ a: b.newPair!.matchId, b: b.newPair!.matchId });
    expect(b.state.queue!.a).toBeUndefined();
  });

  it('khoảng rating mở rộng theo thời gian chờ', () => {
    expect(ratingWindow(0)).toBe(100);
    expect(ratingWindow(30_000)).toBe(250);
    expect(ratingWindow(10 * 60_000)).toBe(600);
    let st = mmEnqueue(null, { uid: 'a', name: 'A', rating: 1000, tc: '5+0' }, 0, ids).state;
    expect(mmEnqueue(st, { uid: 'b', name: 'B', rating: 1300, tc: '5+0' }, 1000, ids).status).toBe('queued');
    st = mmEnqueue(st, { uid: 'b', name: 'B', rating: 1300, tc: '5+0' }, 1000, ids).state;
    // a poll lại sau 50s (giữ heartbeat), b cũng chờ đủ lâu => khoảng >= 300
    for (let t = 5000; t <= 60_000; t += 5000) {
      st = mmEnqueue(st, { uid: 'b', name: 'B', rating: 1300, tc: '5+0' }, t, ids).state;
      const r = mmEnqueue(st, { uid: 'a', name: 'A', rating: 1000, tc: '5+0' }, t + 1, ids);
      st = r.state;
      if (r.status === 'matched') {
        expect(t).toBeGreaterThanOrEqual(40_000);
        return;
      }
    }
    throw new Error('không ghép được dù đã chờ lâu');
  });

  it('lease: người đang có trận rated (hoặc chờ tính điểm) không vào hàng chờ được', () => {
    const st: MmState = { active: { a: 'm_old' } };
    expect(mmEnqueue(st, { uid: 'a', name: 'A', rating: 1200, tc: '5+0' }, 0, ids).status).toBe('busy');
  });

  it('race hủy vs đã ghép: hủy sau khi ghép trả về matched (không mất trận)', () => {
    let st = mmEnqueue(null, { uid: 'a', name: 'A', rating: 1200, tc: '5+0' }, 0, ids).state;
    st = mmEnqueue(st, { uid: 'b', name: 'B', rating: 1200, tc: '5+0' }, 10, ids).state;
    expect(mmCancel(st, 'a').status).toBe('matched');
    const lone = mmEnqueue(null, { uid: 'z', name: 'Z', rating: 1200, tc: '5+0' }, 0, ids).state;
    const c = mmCancel(lone, 'z');
    expect(c.status).toBe('cancelled');
    expect(c.state.queue?.z).toBeUndefined();
    expect(mmCancel(c.state, 'z').status).toBe('not_queued');
  });

  it('mục chờ không heartbeat bị loại', () => {
    const st = mmEnqueue(null, { uid: 'a', name: 'A', rating: 1200, tc: '5+0' }, 0, ids).state;
    const r = mmEnqueue(st, { uid: 'b', name: 'B', rating: 1200, tc: '5+0' }, 60_000, ids);
    expect(r.status).toBe('queued');
    expect(r.state.queue!.a).toBeUndefined();
  });
});

describe('Elo & thống kê', () => {
  it('Elo cân bằng: thắng đối thủ ngang điểm +K/2', () => {
    const r = eloUpdate({ rating: 1200, ratedGames: 20 }, { rating: 1200, ratedGames: 20 }, 1);
    expect(r).toEqual({ a: 1216, b: 1184 });
    const d = eloUpdate({ rating: 1400, ratedGames: 20 }, { rating: 1200, ratedGames: 20 }, 0.5);
    expect(d.a).toBeLessThan(1400);
    expect(d.b).toBeGreaterThan(1200);
  });

  it('K tạm thời cao hơn cho người mới', () => {
    const r = eloUpdate({ rating: 1200, ratedGames: 0 }, { rating: 1200, ratedGames: 50 }, 1);
    expect(r.a).toBe(1220);
    expect(r.b).toBe(1184);
  });

  it('friendly không đổi rating; win rate = thắng / trận rated', () => {
    let s = defaultStats();
    s = applyOutcome(s, 'win', false, null, 'm1');
    expect(s.rating).toBe(1200);
    expect(s.friendlyWins).toBe(1);
    expect(s.ratedGames).toBe(0);
    s = applyOutcome(s, 'win', true, 1216, 'm2');
    s = applyOutcome(s, 'draw', true, 1214, 'm3');
    s = applyOutcome(s, 'loss', true, 1199, 'm4');
    expect(s).toMatchObject({ ratedGames: 3, wins: 1, draws: 1, losses: 1, rating: 1199, peakRating: 1216 });
    expect(winRate(s)).toBe(33.3);
  });
});

describe('phòng', () => {
  const owner = { uid: 'own', name: 'Chủ' };
  const guest = { uid: 'gst', name: 'Khách' };
  const base = () => newRoom({ roomId: 'r1', owner, mode: 'friendly', visibility: 'public', tc: '10+5', ownerColor: 'red', now: 0 });

  it('waiting -> ready -> playing; màu theo lựa chọn chủ phòng', () => {
    const j = joinAsPlayer(base(), guest, 1);
    expect(j.room!.meta.status).toBe('ready');
    const r1 = setReady(j.room, owner.uid, true, 2, 'mA').room!;
    expect(r1.meta.status).toBe('ready');
    const r2 = setReady(r1, guest.uid, true, 3, 'mA');
    expect(r2.startedMatchId).toBe('mA');
    expect(r2.room!.meta.status).toBe('playing');
    expect(r2.room!.matches!.mA.players.red.uid).toBe(owner.uid);
  });

  it('ghế thứ hai được claim một lần: người vào sau bị từ chối', () => {
    const j = joinAsPlayer(base(), guest, 1).room;
    const late = joinAsPlayer(j, { uid: 'late', name: 'Trễ' }, 2);
    expect(late.code).toBe('seat_taken');
    expect(late.commit).toBe(false);
  });

  it('phòng riêng tư: cần membership player; spectator không vào ghế được', () => {
    const priv = newRoom({ roomId: 'r2', owner, mode: 'friendly', visibility: 'private', tc: '10+5', ownerColor: 'random', now: 0 });
    expect(joinAsPlayer(priv, guest, 1).code).toBe('permission_denied');
    const withViewer = { ...priv, members: { ...priv.members, gst: { role: 'spectator' as const, at: 1 } } };
    expect(joinAsPlayer(withViewer, guest, 2).code).toBe('permission_denied');
    const withPlayer = { ...priv, members: { ...priv.members, gst: { role: 'player' as const, at: 1 } } };
    expect(joinAsPlayer(withPlayer, guest, 2).code).toBe('ok');
  });

  it('không đổi cài đặt / đá khách sau khi bắt đầu; không vào ghế phòng ranked', () => {
    const j = joinAsPlayer(base(), guest, 1).room!;
    const p = setReady(setReady(j, owner.uid, true, 2, 'mA').room, guest.uid, true, 3, 'mA').room!;
    expect(updateSettings(p, owner.uid, { tc: '5+0' }, 4).code).toBe('bad_state');
    expect(kickGuest(p, owner.uid, 4).code).toBe('bad_state');
    expect(leaveRoom(p, guest.uid, 4).code).toBe('bad_state');
    const ranked = newRankedRoom({
      roomId: 'r3',
      matchId: 'mR',
      a: { uid: 'x', name: 'X', rating: 1200 },
      b: { uid: 'y', name: 'Y', rating: 1210 },
      tc: '5+0',
      now: 0,
    });
    expect(ranked.meta.status).toBe('playing');
    expect(joinAsPlayer(ranked, guest, 1).code).toBe('not_allowed');
  });

  it('đấu lại tạo matchId mới, đổi màu, không ghi đè trận trước', () => {
    const j = joinAsPlayer(base(), guest, 1).room!;
    const p = setReady(setReady(j, owner.uid, true, 2, 'mA').room, guest.uid, true, 3, 'mA').room!;
    const finished = JSON.parse(JSON.stringify(p));
    finished.meta.status = 'finished';
    const r1 = requestRematch(finished, owner.uid, 10, 'mB').room!;
    expect(r1.meta.status).toBe('finished');
    const r2 = requestRematch(r1, guest.uid, 11, 'mB');
    expect(r2.startedMatchId).toBe('mB');
    expect(Object.keys(r2.room!.matches!)).toEqual(['mA', 'mB']);
    expect(r2.room!.matches!.mB.players.red.uid).toBe(guest.uid);
  });
});
