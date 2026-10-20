import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { POSTGRES, REDIS } from '../infrastructure/infrastructure.module';

type DependencyStatus = 'ok' | 'error';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(POSTGRES) private readonly postgres: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  liveness() {
    return {
      status: 'ok',
      service: 'transporte-api',
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<{
    status: 'ok' | 'degraded';
    checks: { postgres: DependencyStatus; redis: DependencyStatus };
    timestamp: string;
  }> {
    const checks: { postgres: DependencyStatus; redis: DependencyStatus } = {
      postgres: 'error',
      redis: 'error',
    };

    try {
      await this.postgres.query('SELECT 1');
      checks.postgres = 'ok';
    } catch (error) {
      this.logger.warn(`PostgreSQL readiness check failed: ${this.errorMessage(error)}`);
    }

    try {
      if (this.redis.status === 'wait') {
        await this.redis.connect();
      }
      await this.redis.ping();
      checks.redis = 'ok';
    } catch (error) {
      this.logger.warn(`Redis readiness check failed: ${this.errorMessage(error)}`);
    }

    return {
      status: checks.postgres === 'ok' && checks.redis === 'ok' ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
