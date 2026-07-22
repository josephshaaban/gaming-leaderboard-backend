import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type Redis from 'ioredis';
import { REDIS_CLIENT, leaderboardKey } from '../redis/redis.constants';
import { Game } from '../games/entities/game.entity';
import { Match } from '../matches/entities/match.entity';
import { LeaderboardEntry } from '../websocket/protocol';

export interface ScoreUpdateResult {
  previousRank: number | null;
  newRank: number;
  previousScore: number;
  newScore: number;
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(Game) private readonly gamesRepo: Repository<Game>,
    @InjectRepository(Match) private readonly matchesRepo: Repository<Match>,
  ) {}

  /** Rebuilds every game's Redis ZSET from Postgres. Postgres is the source of truth; this makes Redis fully disposable. */
  async rehydrateAll(): Promise<void> {
    const games = await this.gamesRepo.find();
    await Promise.all(games.map((game) => this.rehydrate(game.id)));
  }

  async rehydrate(gameId: string): Promise<void> {
    const rows = await this.matchesRepo
      .createQueryBuilder('match')
      .select('match.playerId', 'playerId')
      .addSelect('SUM(match.score)', 'total')
      .where('match.gameId = :gameId', { gameId })
      .groupBy('match.playerId')
      .getRawMany<{ playerId: string; total: string }>();

    const key = leaderboardKey(gameId);
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    for (const row of rows) {
      pipeline.zadd(key, Number(row.total), row.playerId);
    }
    await pipeline.exec();
  }

  /**
   * Rebuilds the ZSET from Postgres if it's missing. Public because
   * MatchesService must call this BEFORE writing a new match row - if a
   * cache-miss rehydrate ran AFTER that write, the aggregate query would
   * include the just-inserted row and recordScoreDelta's subsequent
   * ZINCRBY would double-count it.
   */
  async ensureCache(gameId: string): Promise<void> {
    const exists = await this.redis.exists(leaderboardKey(gameId));
    if (!exists) {
      await this.rehydrate(gameId);
    }
  }

  async getTopN(
    gameId: string,
    offset: number,
    limit: number,
  ): Promise<LeaderboardEntry[]> {
    await this.assertGameExists(gameId);
    await this.ensureCache(gameId);

    const raw = await this.redis.zrevrange(
      leaderboardKey(gameId),
      offset,
      offset + limit - 1,
      'WITHSCORES',
    );

    const entries: LeaderboardEntry[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      entries.push({
        playerId: raw[i],
        score: Number(raw[i + 1]),
        rank: offset + i / 2 + 1,
      });
    }
    return entries;
  }

  async getRank(
    gameId: string,
    playerId: string,
  ): Promise<{ playerId: string; rank: number; score: number } | null> {
    await this.assertGameExists(gameId);
    await this.ensureCache(gameId);

    const key = leaderboardKey(gameId);
    const [rank, score] = await Promise.all([
      this.redis.zrevrank(key, playerId),
      this.redis.zscore(key, playerId),
    ]);

    if (rank === null || score === null) {
      return null;
    }
    return { playerId, rank: rank + 1, score: Number(score) };
  }

  /**
   * Applies a score delta and returns the player's rank/score before and
   * after. Returns null if Redis is unavailable - callers must treat that as
   * "the cache update failed, but the Postgres write already succeeded", not
   * as a fatal error, since the ZSET self-heals on the next read.
   *
   * Callers MUST have already called `ensureCache` for this gameId BEFORE
   * persisting the new match to Postgres - see the note on `ensureCache`.
   */
  async recordScoreDelta(
    gameId: string,
    playerId: string,
    delta: number,
  ): Promise<ScoreUpdateResult | null> {
    try {
      const key = leaderboardKey(gameId);

      const previousScoreRaw = await this.redis.zscore(key, playerId);
      const previousRankRaw =
        previousScoreRaw === null
          ? null
          : await this.redis.zrevrank(key, playerId);

      const newScore = await this.redis.zincrby(key, delta, playerId);
      const newRankRaw = await this.redis.zrevrank(key, playerId);

      return {
        previousRank: previousRankRaw === null ? null : previousRankRaw + 1,
        newRank: (newRankRaw ?? 0) + 1,
        previousScore: previousScoreRaw === null ? 0 : Number(previousScoreRaw),
        newScore: Number(newScore),
      };
    } catch (err) {
      this.logger.error(
        `Redis leaderboard update failed for game=${gameId} player=${playerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async assertGameExists(gameId: string): Promise<void> {
    const exists = await this.gamesRepo.exists({ where: { id: gameId } });
    if (!exists) {
      throw new NotFoundException(`Game ${gameId} not found`);
    }
  }
}
