import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import type { SearchMatchesDto } from './lib/dto';
import { KyselyService } from 'src/common/kysely.service';
import { addMatchFilter } from './lib/kysely';
import { sql } from 'kysely';
import { PlayerDataType } from '@prisma/client';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

@Injectable()
export class MatchRepository {
  constructor(
    private prisma: PrismaService,
    private kysely: KyselyService,
  ) {}

  public async searchPlayerByName(name: string) {
    const players = await this.prisma.platformPlayer.findMany({
      where: {
        name: {
          contains: name,
          mode: 'insensitive',
        },
      },
      orderBy: [{ name: 'asc' }],
      take: 10,
      select: {
        id: true,
        name: true,
        platform: true,
      },
    });

    return players ?? [];
  }

  public async searchMatches(dto: SearchMatchesDto) {
    const baseQuery = addMatchFilter(dto, this.kysely.selectFrom('Match'));

    const filteredQuery = dto.filters.reduce((query, filter) => {
      return query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('Player as p')
            .innerJoin('PlatformPlayer as pp', 'pp.id', 'p.platformPlayerId')
            .select('p.id')
            .whereRef('p.matchId', '=', 'Match.id')
            .$if(!!filter.playerId, (q) =>
              q.where('pp.id', '=', filter.playerId!),
            )
            .$if(!!filter.race, (q) => q.where('p.raceId', '=', filter.race!))
            .$if(!!filter.bonus, (q) =>
              q
                .innerJoin('PlayerData as pd', 'pd.playerId', 'p.id')
                .where(
                  'pd.type',
                  '=',
                  sql<PlayerDataType>`${PlayerDataType.BONUS}::"PlayerDataType"`,
                )
                .where('pd.value', '=', filter.bonus!),
            )
            .$if(!!filter.place, (q) => q.where('p.place', '=', filter.place!)),
        ),
      );
    }, baseQuery);

    const query = filteredQuery
      .innerJoin('MapProcess', 'Match.mapProcessId', 'MapProcess.id')
      .innerJoin('MapVersion as mv', 'mv.id', 'MapProcess.mapId')
      .leftJoin(
        'W3ChampionsMatch',
        'W3ChampionsMatch.mapProcessId',
        'MapProcess.id',
      )
      .select((s) => [
        'Match.id as id',
        'MapProcess.platform as platform',
        s.fn
          .coalesce(
            'W3ChampionsMatch.id',
            // There is may be other platforms
          )
          .$castTo<string>()
          .as('platformId'),
        'mv.mapType as type',
        sql<string>`CONCAT(${s.ref('mv.mapVersion')}, ${s.ref('mv.mapPatch')})`.as(
          'version',
        ),
        'Match.duration as duration',
        'Match.endAt as endAt',
        'Match.avgQuantile as quantile',
        jsonArrayFrom(
          s
            .selectFrom('Player as p')
            .innerJoin('PlatformPlayer as pp', 'pp.id', 'p.platformPlayerId')
            .whereRef('p.matchId', '=', 'Match.id')
            .select((sp) => [
              'pp.id as id',
              'pp.name as name',
              'p.place as place',
              'p.quantile as quantile',
              'p.raceId as race',
              'p.timeAlive as timeAlive',
              sp
                .selectFrom('PlayerData as pd')
                .whereRef('pd.playerId', '=', 'p.id')
                .where(
                  'pd.type',
                  '=',
                  sql<PlayerDataType>`${PlayerDataType.BONUS}::"PlayerDataType"`,
                )
                .select(
                  sql<string[]>`COALESCE(json_agg(pd.value), '[]'::json)`.as(
                    'bonus',
                  ),
                )
                .$castTo<string[]>()
                .as('bonus'),
              sp
                .selectFrom('PlayerData as pd')
                .whereRef('pd.playerId', '=', 'p.id')
                .where(
                  'pd.type',
                  '=',
                  sql<PlayerDataType>`${PlayerDataType.ULTIMATE}::"PlayerDataType"`,
                )
                .select('pd.value')
                .as('ultimate'),
              sp
                .selectFrom('PlayerData as pd')
                .whereRef('pd.playerId', '=', 'p.id')
                .where(
                  'pd.type',
                  '=',
                  sql<PlayerDataType>`${PlayerDataType.AURA}::"PlayerDataType"`,
                )
                .select('pd.value')
                .as('aura'),
              jsonArrayFrom(
                sp
                  .selectFrom('PlayerEvent as pe')
                  .whereRef('pe.playerMatchId', '=', 'p.id')
                  .select([
                    'pe.eventId as id',
                    'pe.eventType as type',
                    'pe.time',
                  ])
                  .orderBy('time'),
              ).as('events'),
            ])
            .orderBy('p.place', 'asc'),
        ).as('players'),
      ])
      .orderBy('Match.endAt', 'desc')
      .limit(dto.perPage)
      .offset(((dto.page ?? 1) - 1) * dto.perPage);

    const data = await query.execute();

    const total = await filteredQuery
      .select((s) => s.fn.count('Match.id').$castTo<number>().as('total'))
      .executeTakeFirst();
    return { total: total?.total ?? 0, perPage: dto.perPage, data };
  }
}
