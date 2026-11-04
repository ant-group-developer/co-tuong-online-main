/**
 * Elo có version (RATING_CONFIG.version). Hàm thuần để test và để dùng trong Firestore transaction.
 */
import { RATING_CONFIG } from '../config.js';

export interface PlayerStats {
  rating: number;
  peakRating: number;
  ratedGames: number;
  wins: number;
  losses: number;
  draws: number;
  friendlyGames: number;
  friendlyWins: number;
  friendlyLosses: number;
  friendlyDraws: number;
  ratingVersion: string;
  lastRatedMatchId: string | null;
}

export function defaultStats(): PlayerStats {
  return {
    rating: RATING_CONFIG.initial,
    peakRating: RATING_CONFIG.initial,
    ratedGames: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    friendlyGames: 0,
    friendlyWins: 0,
    friendlyLosses: 0,
    friendlyDraws: 0,
    ratingVersion: RATING_CONFIG.version,
    lastRatedMatchId: null,
  };
}

export function kFactor(ratedGames: number): number {
  return ratedGames < RATING_CONFIG.provisionalGames ? RATING_CONFIG.kProvisional : RATING_CONFIG.kStable;
}

/** score: 1 thắng, 0.5 hòa, 0 thua (góc nhìn người chơi A). Trả về rating mới của A, B (làm tròn). */
export function eloUpdate(
  a: { rating: number; ratedGames: number },
  b: { rating: number; ratedGames: number },
  scoreA: 0 | 0.5 | 1,
): { a: number; b: number } {
  const expA = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
  const expB = 1 - expA;
  const na = Math.round(a.rating + kFactor(a.ratedGames) * (scoreA - expA));
  const nb = Math.round(b.rating + kFactor(b.ratedGames) * (1 - scoreA - expB));
  return { a: Math.max(RATING_CONFIG.floor, na), b: Math.max(RATING_CONFIG.floor, nb) };
}

/** Tỉ lệ thắng = số trận thắng / số trận rated (hòa KHÔNG tính là thắng). 0 khi chưa có trận. */
export function winRate(s: Pick<PlayerStats, 'wins' | 'ratedGames'>): number {
  return s.ratedGames > 0 ? Math.round((s.wins / s.ratedGames) * 1000) / 10 : 0;
}

export type Outcome = 'win' | 'loss' | 'draw';

export function applyOutcome(stats: PlayerStats, outcome: Outcome, rated: boolean, newRating: number | null, matchId: string): PlayerStats {
  const s = { ...stats };
  if (rated) {
    s.ratedGames++;
    if (outcome === 'win') s.wins++;
    else if (outcome === 'loss') s.losses++;
    else s.draws++;
    if (newRating !== null) {
      s.rating = newRating;
      s.peakRating = Math.max(s.peakRating, newRating);
    }
    s.lastRatedMatchId = matchId;
    s.ratingVersion = RATING_CONFIG.version;
  } else {
    s.friendlyGames++;
    if (outcome === 'win') s.friendlyWins++;
    else if (outcome === 'loss') s.friendlyLosses++;
    else s.friendlyDraws++;
  }
  return s;
}
