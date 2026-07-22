import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { validate } from './config/env.validation';
import {
  CorrelationIdMiddleware,
  CORRELATION_ID_HEADER,
} from './common/middleware/correlation-id.middleware';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { GamesModule } from './games/games.module';
import { MatchesModule } from './matches/matches.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { WebsocketModule } from './websocket/websocket.module';
import { HealthModule } from './health/health.module';
import { User } from './users/entities/user.entity';
import { RefreshToken } from './auth/entities/refresh-token.entity';
import { Game } from './games/entities/game.entity';
import { Match } from './matches/entities/match.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          genReqId: (req: {
            headers: Record<string, string | string[] | undefined>;
          }) =>
            (req.headers[CORRELATION_ID_HEADER] as string | undefined) ??
            randomUUID(),
          customProps: (req: { id?: unknown }) => ({
            correlationId:
              typeof req.id === 'string' || typeof req.id === 'number'
                ? `${req.id}`
                : undefined,
          }),
          transport:
            process.env.NODE_ENV === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: [User, RefreshToken, Game, Match],
        synchronize: false,
        migrationsRun: false,
      }),
    }),
    RedisModule,
    UsersModule,
    AuthModule,
    GamesModule,
    LeaderboardModule,
    MatchesModule,
    WebsocketModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
