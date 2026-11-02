import { Module } from '@nestjs/common';
import { PricingPoliciesController } from './pricing-policies.controller';
import { PricingPoliciesService } from './pricing-policies.service';
import { AccessTokenGuard } from '../auth/access-token.guard';

@Module({
  controllers: [PricingPoliciesController],
  providers: [PricingPoliciesService, AccessTokenGuard],
})
export class PricingPoliciesModule {}
