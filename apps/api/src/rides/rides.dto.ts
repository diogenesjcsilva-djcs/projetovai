import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CoordinateDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
}

export class CreateRideDto {
  pickup!: CoordinateDto;
  destination!: CoordinateDto;
  @IsString() @MinLength(3) @MaxLength(300) pickupAddress!: string;
  @IsString() @MinLength(3) @MaxLength(300) destinationAddress!: string;
  @IsOptional() @IsInt() @Min(1) estimatedDistanceMeters?: number;
  @IsOptional() @IsInt() @Min(1) estimatedDurationSeconds?: number;
}

export class RideStatusDto {
  @IsIn(['driver_arriving', 'in_progress', 'completed', 'cancelled'])
  status!: 'driver_arriving' | 'in_progress' | 'completed' | 'cancelled';
  @IsOptional() @IsInt() @Min(0) finalFareCents?: number;
}

export class DriverLocationDto extends CoordinateDto {
  @IsOptional() @IsInt() @Min(0) @Max(359) headingDegrees?: number;
  @IsOptional() @IsIn([true, false]) isAvailable?: boolean;
}