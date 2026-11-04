import type { EndReason, GameResult, Side } from '@xq/engine';

export type RoomMode = 'ranked' | 'friendly';
export type Visibility = 'public' | 'private';
export type RoomStatus = 'waiting' | 'ready' | 'playing' | 'finished' | 'cancelled';
export type MatchStatus = 'playing' | 'finished' | 'aborted';

export interface PlayerInfo {
  uid: string;
  name: string;
  rating?: number | null;
}

export interface ClockState {
  red: number;
  black: number;
  /** Thời điểm server (ms UTC) bắt đầu lượt hiện tại. */
  turnStartedAt: number;
  incrementMs: number;
}

export interface MatchResult {
  winner: GameResult;
  reason: EndReason;
  endedAt: number;
}

export interface MatchState {
  /** Version tăng mỗi lần commit thay đổi trạng thái. */
  v: number;
  status: MatchStatus;
  startFen: string;
  /** Các nước ICCS cách nhau bởi dấu cách (giới hạn bởi MAX_PLIES của engine). */
  moves: string;
  fen: string;
  ply: number;
  turn: Side;
  lastMove: string | null;
  inCheck: boolean;
  clock: ClockState;
  /** Deadline hiệu lực (ms) của lượt hiện tại – dùng cho task hẹn giờ & sweep. null khi kết thúc. */
  deadline: number | null;
  drawOffer: Side | null;
  undoRequest: Side | null;
  result: MatchResult | null;
  hash: string;
}

export interface CommandRecord {
  uid: string;
  ok: boolean;
  code: string;
  v: number;
  at: number;
}

export interface MatchDoc {
  matchId: string;
  roomId: string;
  mode: RoomMode;
  rated: boolean;
  visibility: Visibility;
  players: { red: PlayerInfo; black: PlayerInfo };
  createdAt: number;
  rulesVersion: string;
  state: MatchState;
  cmds?: Record<string, CommandRecord>;
  outbox?: { status: 'pending' | 'done'; createdAt: number; processedAt?: number; attempts?: number } | null;
}

export type CommandType =
  | 'move'
  | 'resign'
  | 'offerDraw'
  | 'respondDraw'
  | 'requestUndo'
  | 'respondUndo'
  | 'claimTimeout'
  | 'claimAbandon';

export interface MatchCommand {
  type: CommandType;
  commandId: string;
  expectedVersion: number;
  from?: string;
  to?: string;
  accept?: boolean;
}

export interface CommandContext {
  uid: string;
  now: number;
  /** Đối thủ đã mất kết nối từ thời điểm nào (ms) – chỉ dùng cho claimAbandon; null nếu đang online. */
  opponentOfflineSince?: number | null;
}

export type CommandCode =
  | 'ok'
  | 'duplicate'
  | 'not_player'
  | 'not_found'
  | 'game_over'
  | 'stale_version'
  | 'not_your_turn'
  | 'illegal_move'
  | 'bad_request'
  | 'no_offer'
  | 'not_allowed'
  | 'not_expired'
  | 'timeout';

export interface CommandOutcome {
  /** Có ghi gì xuống DB không (commit). */
  commit: boolean;
  match: MatchDoc;
  ok: boolean;
  code: CommandCode;
  message?: string;
  /** Trận vừa chuyển sang trạng thái kết thúc trong lệnh này. */
  finished: boolean;
}
