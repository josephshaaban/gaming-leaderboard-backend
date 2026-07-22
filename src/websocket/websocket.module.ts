import { Module } from '@nestjs/common';
import { ConnectionRegistry } from './connection-registry';
import { RedisSubscriberService } from './redis-subscriber.service';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { GamesModule } from '../games/games.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [LeaderboardModule, GamesModule, AuthModule],
  providers: [ConnectionRegistry, RedisSubscriberService],
  exports: [ConnectionRegistry],
})
export class WebsocketModule {}
