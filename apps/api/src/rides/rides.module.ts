import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { AccessTokenGuard } from '../auth/access-token.guard';

@Module({
  controllers: [RidesController],
  providers: [RidesService, AccessTokenGuard],
})
export class RidesModule {}
