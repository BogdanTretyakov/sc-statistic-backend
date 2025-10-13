import type { SelectQueryBuilder } from 'kysely';
import type { BaseAnalyticDto, BaseRaceDto } from './dto';
import { PlayerEvents } from '@prisma/client';
import type { DB } from 'src/common/types/kysely';

export function addMatchFilter<
  T extends SelectQueryBuilder<DB, 'Match', unknown>,
>(dto: BaseAnalyticDto, query: T) {
  const {
    date_from,
    date_to,
    duration_from,
    duration_to,
    quantile_from,
    quantile_to,
    withLeavers,
    type,
    version,
  } = dto;

  return query
    .innerJoin('MapVersion', 'MapVersion.id', 'Match.mapId')
    .where('MapVersion.dataKey', '=', `${type}_${version}`)
    .where('MapVersion.ignore', '=', false)
    .$if(!withLeavers, (q) => q.where('Match.hasLeavers', '=', false))
    .$if(!!date_from, (q) => q.where('Match.endAt', '>=', date_from!))
    .$if(!!date_to, (q) => q.where('Match.endAt', '<=', date_to!))
    .$if(!!duration_from, (q) =>
      q.where('Match.duration', '>=', duration_from!),
    )
    .$if(!!duration_to, (q) => q.where('Match.duration', '<=', duration_to!))
    .$if(!!quantile_from, (q) =>
      q.where('Match.avgQuantile', '>=', quantile_from!),
    )
    .$if(!!quantile_to, (q) =>
      q.where('Match.avgQuantile', '<=', quantile_to!),
    ) as T;
}

export function addPlayerWhere<
  T extends SelectQueryBuilder<DB, 'Player', unknown>,
>(dto: BaseRaceDto, query: T) {
  const { race, onlyWinners, afterRepick, vsRace, ...matchDto } = dto;

  const playerQuery = query
    .where('Player.raceId', '=', dto.race)
    .$if(!!onlyWinners, (e) => e.where('Player.place', '=', 1))
    .$if(!!afterRepick, (e) =>
      e.where((w) =>
        w.exists(
          w
            .selectFrom('PlayerEvent as pe')
            .whereRef('pe.playerMatchId', '=', 'Player.id')
            .where('pe.eventType', '=', PlayerEvents.REPICK_RACE)
            .limit(1),
        ),
      ),
    )
    .innerJoin('Match', 'Player.matchId', 'Match.id');

  return addMatchFilter(matchDto, playerQuery) as T;
}
