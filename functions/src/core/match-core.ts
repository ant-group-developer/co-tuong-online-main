/**
 * Lõi xử lý lệnh trận đấu – HÀM THUẦN, không side effect, không phụ thuộc Firebase.
 * Được gọi bên trong callback transaction RTDB (callback có thể chạy lại nhiều lần nên phải thuần).
 *
 * Bất biến:
 *  - Mỗi commit tăng state.v đúng 1.
 *  - Lệnh đã chấp nhận được ghi vào cmds[commandId]; gửi lại cùng commandId => trả kết quả cũ, không áp dụng lần 2.
 *  - Lệnh với expectedVersion cũ (khi bắt buộc khớp version) bị từ chối 'stale_version' để client resync.
 *  - Deadline được kiểm tra TRƯỚC mọi lệnh: quá giờ thì kết thúc ván do hết giờ, bất kể lệnh là gì.
 *  - Kết quả cuối chỉ được ghi một lần: sau khi status != 'playing' mọi lệnh đều bị từ chối 'game_over'.
 */
import {
  Game,
  IllegalMoveError,
  MAX_PLIES,
  RULES_VERSION,
  START_FEN,
  opposite,
  replayMoves,
  type EndReason,
  type GameResult,
  type Side,
} from '@xq/engine';
import { MATCH_POLICY } from '../config.js';
import type {
  CommandCode,
  CommandContext,
  CommandOutcome,
  MatchCommand,
  MatchDoc,
  MatchState,
  PlayerInfo,
  RoomMode,
  Visibility,
} from './types.js';

export interface NewMatchInput {
  matchId: string;
  roomId: string;
  mode: RoomMode;
  rated: boolean;
  visibility: Visibility;
  players: { red: PlayerInfo; black: PlayerInfo };
  initialMs: number;
  incrementMs: number;
  now: number;
  startFen?: string;
}

export function createMatchDoc(input: NewMatchInput): MatchDoc {
  const game = new Game(input.startFen ?? START_FEN);
  const state: MatchState = {
    v: 1,
    status: 'playing',
    startFen: game.startFen,
    moves: '',
    fen: game.fen(),
    ply: 0,
    turn: game.sideToMove,
    lastMove: null,
    inCheck: game.status.inCheck,
    clock: { red: input.initialMs, black: input.initialMs, turnStartedAt: input.now, incrementMs: input.incrementMs },
    deadline: null,
    drawOffer: null,
    undoRequest: null,
    result: null,
    hash: game.stateHash(),
  };
  state.deadline = effectiveDeadline(state);
  return {
    matchId: input.matchId,
    roomId: input.roomId,
    mode: input.mode,
    rated: input.rated,
    visibility: input.visibility,
    players: input.players,
    createdAt: input.now,
    rulesVersion: RULES_VERSION,
    state,
    cmds: {},
    outbox: null,
  };
}

/** Deadline hiệu lực của lượt hiện tại. Hai nước đầu (ply < 2) dùng hạn đi nước đầu, đồng hồ chưa chạy. */
export function effectiveDeadline(s: MatchState): number | null {
  if (s.status !== 'playing') return null;
  if (s.ply < 2) return s.clock.turnStartedAt + MATCH_POLICY.firstMoveMs + MATCH_POLICY.moveGraceMs;
  return s.clock.turnStartedAt + s.clock[s.turn] + MATCH_POLICY.moveGraceMs;
}

/** Thời gian còn lại (ms) của từng bên tại thời điểm `now` (để hiển thị/kết quả). */
export function remainingAt(s: MatchState, now: number): { red: number; black: number } {
  const r = { red: s.clock.red, black: s.clock.black };
  if (s.status === 'playing' && s.ply >= 2) r[s.turn] = Math.max(0, r[s.turn] - (now - s.clock.turnStartedAt));
  return r;
}

function clone(m: MatchDoc): MatchDoc {
  return JSON.parse(JSON.stringify(m)) as MatchDoc;
}

function sideOf(m: MatchDoc, uid: string): Side | null {
  if (m.players.red.uid === uid) return 'red';
  if (m.players.black.uid === uid) return 'black';
  return null;
}

/** Kết thúc ván (thay đổi trên bản sao `m`). */
function finalize(m: MatchDoc, winner: GameResult, reason: EndReason, now: number): void {
  const s = m.state;
  if (s.status === 'playing' && s.ply >= 2) {
    // chốt thời gian còn lại tại thời điểm kết thúc
    const rem = remainingAt(s, now);
    s.clock.red = rem.red;
    s.clock.black = rem.black;
  }
  s.status = reason === 'aborted' ? 'aborted' : 'finished';
  s.result = { winner, reason, endedAt: now };
  s.deadline = null;
  s.drawOffer = null;
  s.undoRequest = null;
  m.outbox = { status: 'pending', createdAt: now, attempts: 0 };
}

/** Nếu lượt hiện tại đã quá hạn: kết thúc ván (hủy nếu chưa đủ 2 nước, ngược lại thua do hết giờ). */
function applyExpiry(m: MatchDoc, now: number): boolean {
  const s = m.state;
  const dl = effectiveDeadline(s);
  if (dl === null || now <= dl) return false;
  if (s.ply < 2) {
    finalize(m, 'draw', 'aborted', now);
  } else {
    const loser = s.turn;
    const winner = opposite(loser);
    // Hết giờ nhưng bên kia không còn quân tấn công để chiếu hết => hòa.
    const game = replayMoves(s.startFen, s.moves);
    const winnerHasAttackers = game.position.hasAttackers(winner === 'red' ? 1 : -1);
    finalize(m, winnerHasAttackers ? winner : 'draw', 'timeout', now);
    s.clock[loser] = 0;
  }
  s.v++;
  return true;
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SQ_RE = /^[a-i][0-9]$/;

export function validateCommand(cmd: unknown): MatchCommand | null {
  const c = cmd as Partial<MatchCommand> | null;
  if (!c || typeof c !== 'object') return null;
  const types = ['move', 'resign', 'offerDraw', 'respondDraw', 'requestUndo', 'respondUndo', 'claimTimeout', 'claimAbandon'];
  if (typeof c.type !== 'string' || !types.includes(c.type)) return null;
  if (typeof c.commandId !== 'string' || !ID_RE.test(c.commandId)) return null;
  if (typeof c.expectedVersion !== 'number' || !Number.isInteger(c.expectedVersion) || c.expectedVersion < 0) return null;
  if (c.type === 'move' && (typeof c.from !== 'string' || typeof c.to !== 'string' || !SQ_RE.test(c.from) || !SQ_RE.test(c.to))) return null;
  if ((c.type === 'respondDraw' || c.type === 'respondUndo') && typeof c.accept !== 'boolean') return null;
  return {
    type: c.type as MatchCommand['type'],
    commandId: c.commandId,
    expectedVersion: c.expectedVersion,
    from: c.from,
    to: c.to,
    accept: c.accept,
  };
}

function pruneCommands(m: MatchDoc): void {
  const entries = Object.entries(m.cmds ?? {});
  if (entries.length <= MATCH_POLICY.keepCommands) return;
  entries.sort((a, b) => b[1].at - a[1].at);
  m.cmds = Object.fromEntries(entries.slice(0, MATCH_POLICY.keepCommands));
}

function reject(m: MatchDoc, code: CommandCode, message?: string): CommandOutcome {
  return { commit: false, match: m, ok: false, code, message, finished: false };
}

/**
 * Áp dụng một lệnh lên trận. Trả về outcome; nếu commit=true thì `match` là trạng thái mới cần ghi.
 */
export function applyCommand(current: MatchDoc, cmd: MatchCommand, ctx: CommandContext): CommandOutcome {
  // 1) Idempotency: lệnh đã xử lý trước đó
  const prev = current.cmds?.[cmd.commandId];
  if (prev) {
    if (prev.uid !== ctx.uid) return reject(current, 'bad_request', 'commandId đã được dùng');
    return { commit: false, match: current, ok: prev.ok, code: 'duplicate', finished: false };
  }
  const side = sideOf(current, ctx.uid);
  if (!side) return reject(current, 'not_player', 'Bạn không phải người chơi của trận này');
  if (current.state.status !== 'playing') return reject(current, 'game_over', 'Trận đã kết thúc');

  const m = clone(current);
  const s = m.state;
  const record = (ok: boolean, code: CommandCode) => {
    m.cmds = m.cmds ?? {};
    m.cmds[cmd.commandId] = { uid: ctx.uid, ok, code, v: s.v, at: ctx.now };
    pruneCommands(m);
  };

  // 2) Hết giờ được xét trước mọi lệnh.
  if (applyExpiry(m, ctx.now)) {
    const ok = cmd.type === 'claimTimeout';
    record(ok, ok ? 'ok' : 'timeout');
    return { commit: true, match: m, ok, code: ok ? 'ok' : 'timeout', message: 'Đã hết giờ', finished: true };
  }

  const opp = opposite(side);
  switch (cmd.type) {
    case 'move': {
      if (cmd.expectedVersion !== s.v) return reject(current, 'stale_version', 'Trạng thái đã thay đổi, cần đồng bộ lại');
      if (s.turn !== side) return reject(current, 'not_your_turn', 'Chưa đến lượt bạn');
      let game: Game;
      try {
        game = replayMoves(s.startFen, s.moves);
      } catch {
        return reject(current, 'bad_request', 'Dữ liệu trận lỗi');
      }
      if (game.sideToMove !== side) return reject(current, 'not_your_turn');
      const iccs = `${cmd.from}${cmd.to}`;
      try {
        game.play(iccs);
      } catch (e) {
        if (e instanceof IllegalMoveError) return reject(current, 'illegal_move', e.message);
        return reject(current, 'illegal_move', 'Nước đi không hợp lệ');
      }
      // Đồng hồ: hai nước đầu không trừ giờ.
      if (s.ply >= 2) {
        const left = s.clock[side] - (ctx.now - s.clock.turnStartedAt);
        s.clock[side] = Math.max(0, left) + s.clock.incrementMs;
      }
      s.clock.turnStartedAt = ctx.now;
      s.moves = s.moves ? `${s.moves} ${iccs}` : iccs;
      s.ply = game.ply;
      s.fen = game.fen();
      s.turn = game.sideToMove;
      s.lastMove = iccs;
      s.inCheck = game.status.inCheck;
      s.hash = game.stateHash();
      s.drawOffer = null;
      s.undoRequest = null;
      s.v++;
      let finished = false;
      if (game.status.over) {
        finalize(m, game.status.result!, game.status.reason!, ctx.now);
        finished = true;
      } else {
        s.deadline = effectiveDeadline(s);
      }
      record(true, 'ok');
      return { commit: true, match: m, ok: true, code: 'ok', finished };
    }
    case 'resign': {
      finalize(m, opp, 'resign', ctx.now);
      s.v++;
      record(true, 'ok');
      return { commit: true, match: m, ok: true, code: 'ok', finished: true };
    }
    case 'offerDraw': {
      if (s.ply < 2) return reject(current, 'not_allowed', 'Chưa thể cầu hòa trước khi hai bên đi nước đầu');
      if (s.drawOffer === opp) {
        finalize(m, 'draw', 'draw_agreement', ctx.now);
        s.v++;
        record(true, 'ok');
        return { commit: true, match: m, ok: true, code: 'ok', finished: true };
      }
      if (s.drawOffer === side) return { commit: false, match: current, ok: true, code: 'ok', finished: false };
      s.drawOffer = side;
      s.v++;
      record(true, 'ok');
      return { commit: true, match: m, ok: true, code: 'ok', finished: false };
    }
    case 'respondDraw': {
      if (s.drawOffer !== opp) return reject(current, 'no_offer', 'Không có lời cầu hòa đang chờ');
      if (cmd.accept) {
        finalize(m, 'draw', 'draw_agreement', ctx.now);
        s.v++;
        record(true, 'ok');
        return { commit: true, match: m, ok: true, code: 'ok', finished: true };
      }
      s.drawOffer = null;
      s.v++;
      record(true, 'ok');
      return { commit: true, match: m, ok: true, code: 'ok', finished: false };
    }
    case 'requestUndo': {
      if (m.mode !== 'friendly') return reject(current, 'not_allowed', 'Không được xin đi lại trong trận xếp hạng');
      if (cmd.expectedVersion !== s.v) return reject(current, 'stale_version');
      const lastBySide = s.turn === side ? 2 : 1; // số nửa nước cần lùi để về lượt của mình
      if (s.ply < lastBySide) return reject(current, 'not_allowed', 'Chưa có nước để đi lại');
      if (s.undoRequest) return reject(current, 'not_allowed', 'Đang có yêu cầu đi lại');
      s.undoRequest = side;
      s.v++;
      record(true, 'ok');
      return { commit: true, match: m, ok: true, code: 'ok', finished: false };
    }
    case 'respondUndo': {
      if (s.undoRequest !== opp) return reject(current, 'no_offer', 'Không có yêu cầu đi lại');
      if (cmd.accept) {
        const requester = opp;
        const back = s.turn === requester ? 2 : 1;
        const list = s.moves ? s.moves.split(' ') : [];
        if (list.length < back) return reject(current, 'not_allowed');
        const kept = list.slice(0, list.length - back);
        const game = replayMoves(s.startFen, kept.join(' '));
        s.moves = kept.join(' ');
        s.ply = game.ply;
        s.fen = game.fen();
        s.turn = game.sideToMove;
        s.lastMove = kept.length ? kept[kept.length - 1] : null;
        s.inCheck = game.status.inCheck;
        s.hash = game.stateHash();
        s.clock.turnStartedAt = ctx.now; // không hoàn thời gian đã dùng
        s.drawOffer = null;
      }
      s.undoRequest = null;
      s.v++;
      s.deadline = effectiveDeadline(s);
      record(true, 'ok');
      return { commit: true, match: m, ok: true, code: 'ok', finished: false };
    }
    case 'claimTimeout':
      return reject(current, 'not_expired', 'Đối thủ vẫn còn thời gian');
    case 'claimAbandon': {
      const since = ctx.opponentOfflineSince;
      if (since === null || since === undefined || ctx.now - since < MATCH_POLICY.abandonAfterMs) {
        return reject(current, 'not_expired', 'Đối thủ chưa mất kết nối đủ lâu');
      }
      if (s.ply < 2) {
        finalize(m, 'draw', 'aborted', ctx.now);
      } else {
        finalize(m, side, 'abandon', ctx.now);
      }
      s.v++;
      record(true, 'ok');
      return { commit: true, match: m, ok: true, code: 'ok', finished: true };
    }
  }
  return reject(current, 'bad_request');
}

/** Xử lý hết giờ từ task/sweep (không gắn với người dùng). */
export function applyTimeoutCheck(current: MatchDoc, now: number, expectedVersion?: number): CommandOutcome {
  if (current.state.status !== 'playing') return reject(current, 'game_over');
  if (expectedVersion !== undefined && expectedVersion !== current.state.v) return reject(current, 'stale_version');
  const m = clone(current);
  if (!applyExpiry(m, now)) return reject(current, 'not_expired');
  return { commit: true, match: m, ok: true, code: 'ok', finished: true };
}

export { MAX_PLIES };
