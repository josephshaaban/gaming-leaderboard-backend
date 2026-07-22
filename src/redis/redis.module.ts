import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from './redis.constants';

function createClient(url: string, name: string): Redis {
  const logger = new Logger(`Redis:${name}`);
  const client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 200, 5000),
  });
  client.on('error', (err) => {
    // Redis is a cache/transport in this system, never the source of truth -
    // a connection error here must be logged, not thrown, so it can never
    // crash a request or an open WebSocket connection.
    logger.error(`Redis client error: ${err.message}`);
  });
  client.on('connect', () => logger.log('connected'));
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createClient(config.getOrThrow<string>('REDIS_URL'), 'command'),
    },
    {
      provide: REDIS_SUBSCRIBER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createClient(config.getOrThrow<string>('REDIS_URL'), 'subscriber'),
    },
  ],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER],
})
export class RedisModule {}
