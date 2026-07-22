import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { LeaderboardEntry } from '../websocket/protocol';
import { Public } from '../common/decorators/public.decorator';

@Public()
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get(':gameId')
  async getTopN(
    @Param('gameId') gameId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<{
    gameId: string;
    offset: number;
    limit: number;
    entries: LeaderboardEntry[];
  }> {
    const entries = await this.leaderboardService.getTopN(
      gameId,
      query.offset,
      query.limit,
    );
    return { gameId, offset: query.offset, limit: query.limit, entries };
  }

  @Get(':gameId/rank/:playerId')
  async getRank(
    @Param('gameId') gameId: string,
    @Param('playerId') playerId: string,
  ): Promise<{ playerId: string; rank: number; score: number }> {
    const result = await this.leaderboardService.getRank(gameId, playerId);
    if (!result) {
      throw new NotFoundException(
        `Player ${playerId} has no score for game ${gameId}`,
      );
    }
    return result;
  }
}
