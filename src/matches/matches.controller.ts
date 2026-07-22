import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { SubmitMatchDto } from './dto/submit-match.dto';
import { Match } from './entities/match.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  submit(
    @Body() dto: SubmitMatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Match> {
    // playerId is always the authenticated caller, never taken from the
    // request body - otherwise any player could submit scores on another
    // player's behalf.
    return this.matchesService.submitMatch(dto.gameId, user.userId, dto.score);
  }
}
