import {
  IsInt, IsNumber, IsOptional, Max, Min,
} from 'class-validator';

export class CreateCityPricingPolicyDto {
  @IsInt() @Min(0)
  baseFareCents!: number;

  @IsInt() @Min(0)
  pricePerKmCents!: number;

  @IsInt() @Min(0)
  pricePerMinuteCents!: number;

  @IsInt() @Min(0)
  minimumFareCents!: number;

  @IsOptional() @IsInt() @Min(0)
  cancellationFeeCents?: number;

  @IsOptional() @IsInt() @Min(0)
  waitingPerMinuteCents?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(300)
  nightSurchargePercent?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(500)
  demandSurchargeMaxPercent?: number;

  @IsOptional() @IsInt() @Min(250) @Max(50000)
  initialSearchRadiusMeters?: number;

  @IsOptional() @IsInt() @Min(250) @Max(100000)
  maxSearchRadiusMeters?: number;

  @IsOptional() @IsInt() @Min(30) @Max(1800)
  driverLocationMaxAgeSeconds?: number;

  @IsOptional() @IsInt() @Min(5) @Max(120)
  searchWaveTimeoutSeconds?: number;
}
