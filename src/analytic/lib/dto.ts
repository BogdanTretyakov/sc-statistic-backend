import { IntersectionType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

function ToBoolean() {
  return Transform(({ value }) => {
    if (typeof value === 'boolean') return value;

    if (typeof value === 'string') {
      const val = value.trim().toLowerCase();
      if (val === 'true') return true;
      if (val === 'false') return false;
      if (val === '1') return true;
      if (val === '0') return false;
    }

    return value;
  });
}

export class MapDto {
  @IsNotEmpty()
  @IsString()
  type: string;

  @IsNotEmpty()
  @IsString()
  version: string;
}
export class DateDto {
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  date_from?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  date_to?: Date;

  @IsInt()
  @IsOptional()
  duration_from?: number;

  @IsInt()
  @IsOptional()
  duration_to?: number;
}

export class MatchDto {
  @IsInt()
  @IsOptional()
  quantile_from?: number;

  @IsInt()
  @IsOptional()
  quantile_to?: number;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  withLeavers = false;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  rankingPlayers = false;
}

export class BaseAnalyticDto extends IntersectionType(
  MapDto,
  DateDto,
  MatchDto,
) {}
export class BaseRaceDto extends BaseAnalyticDto {
  @IsNotEmpty()
  race: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  onlyWinners?: boolean;

  @IsString({ each: true })
  @IsOptional()
  vsRace?: string | string[];
}
