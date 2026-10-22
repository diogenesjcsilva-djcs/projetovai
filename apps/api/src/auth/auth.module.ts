import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SmsGateway } from './sms.gateway';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SmsGateway],
  exports: [AuthService],
})
export class AuthModule {}
