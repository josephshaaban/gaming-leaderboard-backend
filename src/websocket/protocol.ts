export interface LeaderboardEntry {
  playerId: string;
  score: number;
  rank: number;
}

export interface SnapshotMessage {
  type: 'snapshot';
  gameId: string;
  entries: LeaderboardEntry[];
  generatedAt: string;
}

export interface RankUpdateMessage {
  type: 'rank_update';
  gameId: string;
  matchId: string;
  player: { playerId: string };
  previousRank: number | null;
  newRank: number;
  previousScore: number;
  newScore: number;
  delta: number;
  top: LeaderboardEntry[];
  ts: string;
}

export type ErrorCode = 'INVALID_GAME' | 'UNAUTHORIZED' | 'INTERNAL';

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
  ts: string;
}

export type ServerMessage = SnapshotMessage | RankUpdateMessage | ErrorMessage;

export const WS_CLOSE_UNAUTHORIZED = 4401;
export const WS_CLOSE_NOT_FOUND = 4404;
export const WS_CLOSE_SERVER_SHUTDOWN = 1001;
export const WS_CLOSE_INTERNAL_ERROR = 1011;
