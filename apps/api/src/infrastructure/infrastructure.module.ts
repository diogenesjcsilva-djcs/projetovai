import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import Redis from 'ioredis';

export const POSTGRES = Symbol('POSTGRES');
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: POSTGRES,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          max: 10,
          connectionTimeoutMillis: 3000,
          idleTimeoutMillis: 30000,
          application_name: 'transporte-api',
        }),
    },
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>('REDIS_URL'), {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          enableOfflineQueue: false,
        }),
    },
  ],
  exports: [POSTGRES, REDIS],
})
export class InfrastructureModule {}
