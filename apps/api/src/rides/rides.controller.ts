import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { RidesService } from './rides.service';
import { CreateRideDto, DriverLocationDto, RideStatusDto } from './rides.dto';
import { AccessTokenGuard, AuthenticatedRequest } from '../auth/access-token.guard';
import { Req } from '@nestjs/common';
import { Request } from 'express';

type RequestWithUser = Request & { user: AuthenticatedRequest['user'] };

@UseGuards(AccessTokenGuard)
@Controller('/api/v1')
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  @Post('rides')
  create(@Req() req: RequestWithUser, @Body() dto: CreateRideDto, @Headers('idempotency-key') key: string) {
    return this.rides.create(req.user, dto, key);
  }

  @Get('rides/:id')
  findOne(@Req() req: RequestWithUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.rides.findOne(req.user, id);
  }

  @Post('rides/:id/accept')
  accept(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.rides.accept(req.user, id);
  }

  @Post('rides/:id/status')
  updateStatus(@Req() req: RequestWithUser, @Param('id') id: string, @Body() dto: RideStatusDto) {
    return this.rides.updateStatus(req.user, id, dto);
  }

  @Put('drivers/me/location')
  updateLocation(@Req() req: RequestWithUser, @Body() dto: DriverLocationDto) {
    return this.rides.updateLocation(req.user, dto);
  }
}
