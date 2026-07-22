import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Match } from './entities/match.entity';
import { MatchesRepository } from './matches.repository';
import { MatchesService } from './matches.service';
import { MatchesController } from './matches.controller';
import { GamesModule } from '../games/games.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

@Module({
  imports: [TypeOrmModule.forFeature([Match]), GamesModule, LeaderboardModule],
  providers: [MatchesRepository, MatchesService],
  controllers: [MatchesController],
  exports: [MatchesService],
})
export class MatchesModule {}
