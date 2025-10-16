import type { SelectQueryBuilder } from 'kysely';
import type { BaseAnalyticDto, BaseRaceDto } from './dto';
import type { DB } from 'src/common/types/kysely';
import { isNotNil } from 'src/pipeline/lib/guards';

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
  const { race, onlyWinners, vsRace, ...matchDto } = dto;

  const versusRaces = [vsRace].flat().filter(isNotNil);

  const playerQuery = query
    .where('Player.raceId', '=', dto.race)
    .$if(!!onlyWinners, (e) => e.where('Player.place', '=', 1))
    .innerJoin('Match', 'Player.matchId', 'Match.id');

  return addMatchFilter(matchDto, playerQuery).$if(!!versusRaces.length, (e) =>
    e
      .innerJoin('Player as pvr', 'pvr.matchId', 'Match.id')
      .where('pvr.raceId', 'in', versusRaces),
  ) as T;
}
