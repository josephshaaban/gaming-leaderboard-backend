import type Redis from 'ioredis';
import { MatchesService } from './matches.service';
import { MatchesRepository } from './matches.repository';
import { GamesService } from '../games/games.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { Match } from './entities/match.entity';
import { leaderboardUpdatesChannel } from '../redis/redis.constants';
import { RankUpdateMessage } from '../websocket/protocol';

describe('MatchesService', () => {
  let matchesRepository: jest.Mocked<MatchesRepository>;
  let gamesService: jest.Mocked<GamesService>;
  let leaderboardService: jest.Mocked<LeaderboardService>;
  let redis: jest.Mocked<Redis>;
  let service: MatchesService;

  const gameId = 'game-1';
  const playerId = 'player-1';

  beforeEach(() => {
    matchesRepository = {
      create: jest.fn(),
    } as unknown as jest.Mocked<MatchesRepository>;

    gamesService = {
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: gameId }),
    } as unknown as jest.Mocked<GamesService>;

    leaderboardService = {
      ensureCache: jest.fn(),
      recordScoreDelta: jest.fn(),
      getTopN: jest.fn().mockResolvedValue([{ playerId, score: 100, rank: 1 }]),
    } as unknown as jest.Mocked<LeaderboardService>;

    redis = {
      publish: jest.fn(),
    } as unknown as jest.Mocked<Redis>;

    service = new MatchesService(
      matchesRepository,
      gamesService,
      leaderboardService,
      redis,
    );
  });

  it('persists the match to Postgres, updates the Redis ZSET, and publishes a rank_update', async () => {
    const savedMatch = {
      id: 'match-1',
      gameId,
      playerId,
      score: 100,
      createdAt: new Date(),
    } as Match;
    leaderboardService.recordScoreDelta.mockResolvedValue({
      previousRank: null,
      newRank: 1,
      previousScore: 0,
      newScore: 100,
    });

    const callOrder: string[] = [];
    leaderboardService.ensureCache.mockImplementation(() => {
      callOrder.push('ensureCache');
      return Promise.resolve();
    });
    matchesRepository.create.mockImplementation(() => {
      callOrder.push('create');
      return Promise.resolve(savedMatch);
    });

    const result = await service.submitMatch(gameId, playerId, 100);

    expect(result).toBe(savedMatch);
    expect(gamesService.findByIdOrThrow).toHaveBeenCalledWith(gameId);
    expect(matchesRepository.create).toHaveBeenCalledWith(
      gameId,
      playerId,
      100,
    );
    expect(leaderboardService.recordScoreDelta).toHaveBeenCalledWith(
      gameId,
      playerId,
      100,
    );
    // ensureCache MUST run before the Postgres write, otherwise a
    // cache-miss rehydrate would double-count this very match - see
    // leaderboard.service.ts's ensureCache doc comment.
    expect(callOrder).toEqual(['ensureCache', 'create']);

    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel, payload] = redis.publish.mock.calls[0];
    expect(channel).toBe(leaderboardUpdatesChannel(gameId));

    const message = JSON.parse(payload as string) as RankUpdateMessage;
    expect(message).toMatchObject({
      type: 'rank_update',
      gameId,
      matchId: 'match-1',
      player: { playerId },
      previousRank: null,
      newRank: 1,
      previousScore: 0,
      newScore: 100,
      delta: 100,
    });
  });

  it('still durably persists the match to Postgres when Redis is unavailable', async () => {
    const savedMatch = {
      id: 'match-2',
      gameId,
      playerId,
      score: 50,
      createdAt: new Date(),
    } as Match;
    matchesRepository.create.mockResolvedValue(savedMatch);
    // Simulates LeaderboardService already having caught a Redis failure.
    leaderboardService.recordScoreDelta.mockResolvedValue(null);

    const result = await service.submitMatch(gameId, playerId, 50);

    expect(result).toBe(savedMatch);
    expect(redis.publish).not.toHaveBeenCalled();
  });
});
