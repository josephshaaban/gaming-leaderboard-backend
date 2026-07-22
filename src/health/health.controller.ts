import { Controller, Get, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { Public } from '../common/decorators/public.decorator';
import { hostname } from 'node:os';

const START_TIME = Date.now();

interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  replica: string;
  postgres: 'ok' | 'error';
  redis: 'ok' | 'error';
}

@Public()
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const [postgres, redis] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
    ]);

    return {
      status: postgres === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
      replica: hostname(),
      postgres,
      redis,
    };
  }

  private async checkPostgres(): Promise<'ok' | 'error'> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async checkRedis(): Promise<'ok' | 'error'> {
    try {
      await this.redis.ping();
      return 'ok';
    } catch {
      return 'error';
    }
  }
}
