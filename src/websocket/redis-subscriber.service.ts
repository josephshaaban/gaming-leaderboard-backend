import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  LEADERBOARD_UPDATES_PATTERN,
  REDIS_SUBSCRIBER,
  gameIdFromChannel,
} from '../redis/redis.constants';
import { ConnectionRegistry } from './connection-registry';

/**
 * Bridges Redis pub/sub to local WebSocket connections. Every app instance
 * runs one of these, all subscribed to the same pattern - this is what makes
 * a match submitted on instance A reach clients connected to instance B.
 */
@Injectable()
export class RedisSubscriberService implements OnModuleInit {
  private readonly logger = new Logger(RedisSubscriberService.name);

  constructor(
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
    private readonly registry: ConnectionRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.subscriber.psubscribe(LEADERBOARD_UPDATES_PATTERN);

    this.subscriber.on(
      'pmessage',
      (_pattern: string, channel: string, message: string) => {
        const gameId = gameIdFromChannel(channel);
        this.registry.broadcast(gameId, message);
      },
    );

    this.subscriber.on('error', (err) => {
      // A subscriber disconnect must not crash the process. ioredis
      // reconnects automatically (see retryStrategy in redis.module.ts) and
      // resubscribes to previously-subscribed patterns on its own.
      this.logger.error(`Redis subscriber error: ${err.message}`);
    });
  }
}
