import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { AuthModule } from './auth/auth.module';
import { RidesModule } from './rides/rides.module';
import { PricingPoliciesModule } from './rides/pricing-policies.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      cache: true,
    }),
    InfrastructureModule,
    AuthModule,
    RidesModule,
    PricingPoliciesModule,
    HealthModule,
  ],
})
export class AppModule {}
