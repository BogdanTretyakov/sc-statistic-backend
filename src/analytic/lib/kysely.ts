import { sql, type SelectQueryBuilder } from 'kysely';
import type { BaseAnalyticDto, BaseRaceDto } from './dto';
import type { DB } from 'src/common/types/kysely';
import { MatchPlatform } from '@prisma/client';

type Options = Partial<{ skipLeavers: boolean }>;

export function addMatchFilter<
  T extends SelectQueryBuilder<DB, 'Match', unknown>,
>(dto: BaseAnalyticDto, query: T, options?: Options) {
  const {
    date_from,
    date_to,
    duration_from,
    duration_to,
    quantile_from,
    quantile_to,
    withLeavers,
    playerId,
    type,
    version,
    platform,
    season,
  } = dto;

  return query
    .innerJoin('MapVersion', 'MapVersion.id', 'Match.mapId')
    .where('MapVersion.dataKey', '=', `${type}_${version}`)
    .where('MapVersion.ignore', '=', false)
    .$if(!!platform, (q) => {
      const qq = q.innerJoin(
        'MapProcess as fmp',
        'Match.mapProcessId',
        'fmp.id',
      );
      switch (platform) {
        case MatchPlatform.W3Champions:
          return qq
            .where(
              'fmp.platform',
              '=',
              sql<MatchPlatform>`${platform}::"MatchPlatform"`,
            )
            .innerJoin(
              'W3ChampionsMatch as fw3cm',
              'fw3cm.mapProcessId',
              'fmp.id',
            )
            .$if(!!season, (sq) => sq.where('fw3cm.season', '=', season!));
        default:
          return q;
      }
    })
    .$if(!withLeavers && !options?.skipLeavers, (q) =>
      q.where('Match.hasLeavers', '=', false),
    )
    .$if(!!date_from, (q) => q.where('Match.endAt', '>=', date_from!))
    .$if(!!date_to, (q) => q.where('Match.endAt', '<=', date_to!))
    .$if(!!duration_from, (q) =>
      q.where('Match.duration', '>=', duration_from!),
    )
    .$if(!!playerId, (q) =>
      q
        .innerJoin('Player as pp', 'pp.matchId', 'Match.id')
        .where('pp.platformPlayerId', '=', playerId!),
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
>(dto: BaseRaceDto, query: T, options?: Options) {
  const { race, playerId, ...matchDto } = dto;

  const playerQuery = query
    .where('Player.raceId', '=', dto.race)
    .$if(!!playerId, (q) => q.where('Player.platformPlayerId', '=', playerId!))
    .innerJoin('Match', 'Player.matchId', 'Match.id');

  return addMatchFilter(matchDto, playerQuery, options) as T;
}
