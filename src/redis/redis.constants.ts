export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_SUBSCRIBER = Symbol('REDIS_SUBSCRIBER');

export function leaderboardKey(gameId: string): string {
  return `leaderboard:${gameId}`;
}

export function leaderboardUpdatesChannel(gameId: string): string {
  return `leaderboard-updates:${gameId}`;
}

export const LEADERBOARD_UPDATES_PATTERN = 'leaderboard-updates:*';

export function gameIdFromChannel(channel: string): string {
  return channel.slice('leaderboard-updates:'.length);
}
