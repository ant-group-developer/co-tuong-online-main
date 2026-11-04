/** Kiểu dữ liệu đọc từ RTDB (khớp functions/src/core/*). Client chỉ đọc, không ghi các nhánh này. */
import type { EndReason, GameResult, Side } from '@xq/engine';

export interface RoomMeta {
  roomId: string;
  ownerUid: string;
  ownerName: string;
  mode: 'ranked' | 'friendly';
  visibility: 'public' | 'private';
  status: 'waiting' | 'ready' | 'playing' | 'finished' | 'cancelled';
  tc: string;
  ownerColor: 'red' | 'black' | 'random';
  createdAt: number;
  updatedAt: number;
  matchId: string | null;
  matchCount: number;
  rematch?: Record<string, boolean> | null;
}

export interface Seat {
  uid: string;
  name: string;
  ready: boolean;
  rating?: number | null;
}

export interface Seats {
  host?: Seat | null;
  guest?: Seat | null;
}

export interface MatchState {
  v: number;
  status: 'playing' | 'finished' | 'aborted';
  startFen: string;
  moves: string;
  fen: string;
  ply: number;
  turn: Side;
  lastMove: string | null;
  inCheck: boolean;
  clock: { red: number; black: number; turnStartedAt: number; incrementMs: number };
  deadline: number | null;
  drawOffer: Side | null;
  undoRequest: Side | null;
  result: { winner: GameResult; reason: EndReason; endedAt: number } | null;
  hash: string;
}

export interface MatchPlayers {
  red: { uid: string; name: string; rating?: number | null };
  black: { uid: string; name: string; rating?: number | null };
}

export interface RoomStats {
  spectators: number;
  playersOnline?: Record<string, boolean>;
}

export interface PublicRoom {
  roomId: string;
  mode: 'ranked' | 'friendly';
  status: string;
  tc: string;
  tcLabel: string;
  ownerName: string;
  hostName: string | null;
  guestName: string | null;
  seatsFree: number;
  redName: string | null;
  blackName: string | null;
  spectators?: number;
  createdAt: number;
  updatedAt: number;
}
