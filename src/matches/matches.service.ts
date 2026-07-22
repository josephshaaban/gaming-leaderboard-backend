import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  REDIS_CLIENT,
  leaderboardUpdatesChannel,
} from '../redis/redis.constants';
import { MatchesRepository } from './matches.repository';
import { GamesService } from '../games/games.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { Match } from './entities/match.entity';
import { RankUpdateMessage } from '../websocket/protocol';

@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);

  constructor(
    private readonly matchesRepository: MatchesRepository,
    private readonly gamesService: GamesService,
    private readonly leaderboardService: LeaderboardService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async submitMatch(
    gameId: string,
    playerId: string,
    score: number,
  ): Promise<Match> {
    // Confirms the game exists and, more importantly, ensures a bad gameId
    // fails the request before we ever touch Postgres or Redis.
    await this.gamesService.findByIdOrThrow(gameId);

    // The ZSET must be warmed from Postgres BEFORE this match is written -
    // otherwise a cache-miss rehydrate running after the write would
    // aggregate the just-inserted row from Postgres, and the ZINCRBY below
    // would double-count it on top. Best-effort: if Redis is down here, the
    // Postgres write below still proceeds unconditionally, and
    // recordScoreDelta's own try/catch handles the resulting failure.
    try {
      await this.leaderboardService.ensureCache(gameId);
    } catch (err) {
      this.logger.error(
        `Failed to warm leaderboard cache for game=${gameId} before match write: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Postgres write happens next and unconditionally - it is the source
    // of truth. Everything after this point is best-effort cache/broadcast:
    // if Redis is down, the match is still durably recorded.
    const match = await this.matchesRepository.create(gameId, playerId, score);

    const scoreUpdate = await this.leaderboardService.recordScoreDelta(
      gameId,
      playerId,
      score,
    );

    if (scoreUpdate) {
      await this.publishRankUpdate(match, scoreUpdate);
    }

    return match;
  }

  private async publishRankUpdate(
    match: Match,
    scoreUpdate: {
      previousRank: number | null;
      newRank: number;
      previousScore: number;
      newScore: number;
    },
  ): Promise<void> {
    try {
      const top = await this.leaderboardService.getTopN(match.gameId, 0, 10);
      const message: RankUpdateMessage = {
        type: 'rank_update',
        gameId: match.gameId,
        matchId: match.id,
        player: { playerId: match.playerId },
        previousRank: scoreUpdate.previousRank,
        newRank: scoreUpdate.newRank,
        previousScore: scoreUpdate.previousScore,
        newScore: scoreUpdate.newScore,
        delta: match.score,
        top,
        ts: new Date().toISOString(),
      };
      // The matches service never talks to WebSocket clients directly - it
      // only ever publishes here. Every instance, including this one,
      // delivers the update to its local sockets through the same Redis
      // subscriber path, so there is no in-process broadcast shortcut to
      // accidentally take.
      await this.redis.publish(
        leaderboardUpdatesChannel(match.gameId),
        JSON.stringify(message),
      );
    } catch (err) {
      this.logger.error(
        `Failed to publish rank update for match=${match.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
