import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { attachWebSocketServer } from './websocket/attach-ws-server';
import { LeaderboardService } from './leaderboard/leaderboard.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Rebuild every game's Redis ZSET from Postgres on boot. Postgres is the
  // source of truth; this is what makes the leaderboard survive a Redis
  // wipe/restart rather than treating an empty cache as an empty board.
  await app.get(LeaderboardService).rehydrateAll();

  const registry = attachWebSocketServer(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const shutdown = async (signal: string): Promise<void> => {
    const logger = app.get(Logger);
    logger.log(`Received ${signal}, starting graceful shutdown`);
    registry.stopHeartbeat();
    registry.closeAll();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
