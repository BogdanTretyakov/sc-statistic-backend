import { MatchPlatform, type Prisma } from '@prisma/client';
import type { BaseAnalyticDto, BaseRaceDto, MapDto } from './dto';

export function mapFilter(dto: MapDto): Prisma.MapVersionWhereInput {
  return {
    dataKey: `${dto.type}_${dto.version}`,
    ignore: false,
  };
}

export function matchFilter(dto: BaseAnalyticDto): Prisma.MatchWhereInput {
  const {
    date_from,
    date_to,
    duration_from,
    duration_to,
    quantile_from,
    quantile_to,
    withLeavers,
    playerId,
    platform,
    season,
  } = dto;
  const output: Prisma.MatchWhereInput = {
    map: mapFilter(dto),
  };

  if (!withLeavers) {
    output.hasLeavers = false;
  }

  if (playerId) {
    output.players = { some: { platformPlayerId: playerId } };
  }

  if (platform) {
    output.mapProcess = {
      platform,
      ...(platform === MatchPlatform.W3Champions && season
        ? {
            W3ChampionsMatch: {
              some: { season },
            },
          }
        : {}),
    };
  }

  if (date_from || date_to) {
    output.endAt = {
      ...(date_from ? { gte: date_from } : {}),
      ...(date_to ? { lte: date_to } : {}),
    };
  }
  if (duration_from || duration_to) {
    output.duration = {
      ...(duration_from ? { gte: duration_from } : {}),
      ...(duration_to ? { lte: duration_to } : {}),
    };
  }
  if (quantile_from || quantile_to) {
    output.avgQuantile = {
      ...(quantile_from ? { gte: quantile_from } : {}),
      ...(quantile_to ? { lte: quantile_to } : {}),
    };
  }

  return output;
}

export function playerFilter(dto: BaseRaceDto): Prisma.PlayerWhereInput {
  const { race, playerId } = dto;
  const output: Prisma.PlayerWhereInput = {
    raceId: race,
    platformPlayerId: playerId,
  };

  return output;
}
