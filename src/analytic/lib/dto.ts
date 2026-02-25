import { IntersectionType } from '@nestjs/mapped-types';
import { MatchPlatform } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
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

export class PlayerIdDto {
  @IsOptional()
  @IsNumber()
  playerId?: number;
}

export class SeasonDto {
  @IsOptional()
  @IsEnum(MatchPlatform)
  platform?: MatchPlatform;

  @IsOptional()
  @IsString()
  season?: string;
}

export class BaseAnalyticDto extends IntersectionType(
  MapDto,
  DateDto,
  MatchDto,
  PlayerIdDto,
  SeasonDto,
) {}
export class BaseRaceDto extends BaseAnalyticDto {
  @IsNotEmpty()
  race: string;
}

export class PlayerSearchDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

class MatchPlayerFilter extends PlayerIdDto {
  @IsOptional()
  @IsString()
  @Length(4, 4)
  race?: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  bonus?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  place?: number;
}

export class SearchMatchesDto extends BaseAnalyticDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested()
  filters: MatchPlayerFilter[];

  @IsOptional()
  @IsInt()
  @IsPositive()
  page?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(25)
  perPage = 10;

  @IsOptional()
  @IsBoolean()
  events = false;
}

export class SearchMatchByPlatformDto {
  @IsIn(['internal'].concat(Object.values(MatchPlatform)))
  platform: MatchPlatform | 'internal';

  @IsNotEmpty()
  id: string;
}
