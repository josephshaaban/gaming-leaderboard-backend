import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Game } from './entities/game.entity';
import { GamesRepository } from './games.repository';
import { GamesService } from './games.service';
import { GamesController } from './games.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Game])],
  providers: [GamesRepository, GamesService],
  controllers: [GamesController],
  exports: [GamesService],
})
export class GamesModule {}
