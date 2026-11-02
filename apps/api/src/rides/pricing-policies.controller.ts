import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { AccessTokenGuard, AuthenticatedRequest } from '../auth/access-token.guard';
import { CreateCityPricingPolicyDto } from './pricing-policy.dto';
import { PricingPoliciesService } from './pricing-policies.service';

type RequestWithUser = Request & { user: AuthenticatedRequest['user'] };

@UseGuards(AccessTokenGuard)
@Controller('admin/cities')
export class PricingPoliciesController {
  constructor(private readonly policies: PricingPoliciesService) {}

  @Post(':cityId/pricing-policies')
  createVersion(
    @Req() req: RequestWithUser,
    @Param('cityId', new ParseUUIDPipe()) cityId: string,
    @Body() dto: CreateCityPricingPolicyDto,
  ) {
    return this.policies.createVersion(req.user, cityId, dto);
  }

  @Post(':cityId/pricing-policies/:policyId/activate')
  activateVersion(
    @Req() req: RequestWithUser,
    @Param('cityId', new ParseUUIDPipe()) cityId: string,
    @Param('policyId', new ParseUUIDPipe()) policyId: string,
  ) {
    return this.policies.activateVersion(req.user, cityId, policyId);
  }
}
