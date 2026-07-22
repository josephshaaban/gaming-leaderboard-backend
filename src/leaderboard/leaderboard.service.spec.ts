import RedisMock from 'ioredis-mock';
import type { Repository } from 'typeorm';
import { LeaderboardService } from './leaderboard.service';
import { Game } from '../games/entities/game.entity';
import { Match } from '../matches/entities/match.entity';
import { leaderboardKey } from '../redis/redis.constants';

describe('LeaderboardService', () => {
  let redis: InstanceType<typeof RedisMock>;
  let gamesRepo: jest.Mocked<Repository<Game>>;
  let matchesRepo: jest.Mocked<Repository<Match>>;
  let service: LeaderboardService;

  const gameId = 'game-1';

  beforeEach(() => {
    redis = new RedisMock();
    gamesRepo = {
      find: jest.fn(),
      exists: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<Repository<Game>>;

    const rows = [
      { playerId: 'alice', total: '30' },
      { playerId: 'bob', total: '50' },
    ];
    matchesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      }),
    } as unknown as jest.Mocked<Repository<Match>>;

    service = new LeaderboardService(redis, gamesRepo, matchesRepo);
  });

  it('rehydrates the Redis ZSET from Postgres aggregates when the cache is empty', async () => {
    const entries = await service.getTopN(gameId, 0, 10);

    expect(entries).toEqual([
      { playerId: 'bob', score: 50, rank: 1 },
      { playerId: 'alice', score: 30, rank: 2 },
    ]);
  });

  it('rebuilds a wiped cache (simulating a Redis restart) without losing standings', async () => {
    await service.getTopN(gameId, 0, 10);
    await redis.del(leaderboardKey(gameId));

    const entriesAfterWipe = await service.getTopN(gameId, 0, 10);

    expect(entriesAfterWipe).toEqual([
      { playerId: 'bob', score: 50, rank: 1 },
      { playerId: 'alice', score: 30, rank: 2 },
    ]);
  });

  it('applies a score delta and reports before/after rank and score', async () => {
    await service.getTopN(gameId, 0, 10); // warms the cache

    const update = await service.recordScoreDelta(gameId, 'alice', 25);

    expect(update).toEqual({
      previousRank: 2,
      previousScore: 30,
      newRank: 1,
      newScore: 55,
    });
  });

  it('returns null instead of throwing when Redis is unavailable', async () => {
    jest.spyOn(redis, 'zscore').mockRejectedValue(new Error('connection lost'));

    const update = await service.recordScoreDelta(gameId, 'alice', 10);

    expect(update).toBeNull();
  });
});
