import { type Prisma, PlayerEvents } from '@prisma/client';
import type { BaseAnalyticDto, BaseRaceDto, MapDto } from './dto';
import { merge } from 'lodash';

export function mapFilter(dto: MapDto): Prisma.MapVersionWhereInput {
  return {
    dataKey: `${dto.type}_${dto.version}`,
    ignore: false,
  };
}

export function matchFilter(
  dto: BaseAnalyticDto | BaseRaceDto,
): Prisma.MatchWhereInput {
  const {
    date_from,
    date_to,
    duration_from,
    duration_to,
    quantile_from,
    quantile_to,
    withLeavers,
  } = dto;
  const output: Prisma.MatchWhereInput = {
    map: mapFilter(dto),
  };

  if (!withLeavers) {
    output.hasLeavers = false;
  }

  if ('vsRace' in dto) {
    output.players = merge<unknown, Prisma.MatchWhereInput['players']>(
      output.players,
      {
        some: {
          raceId: {
            in: dto.vsRace,
          },
        },
      },
    );
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
  const { race, onlyWinners, afterRepick } = dto;
  const output: Prisma.PlayerWhereInput = {
    raceId: race,
  };

  if (onlyWinners) {
    output.place = 1;
  }
  if (afterRepick) {
    output.events = merge<unknown, Prisma.PlayerWhereInput['events']>(
      output.events,
      { some: { eventType: PlayerEvents.REPICK_RACE } },
    );
  }

  return output;
}
