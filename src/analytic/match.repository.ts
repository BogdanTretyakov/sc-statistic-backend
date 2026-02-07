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

    let filteredQuery = baseQuery;

    if (dto.filters.length > 0) {
      filteredQuery = filteredQuery.where((eb) => {
        let sub: any = eb
          .selectFrom('Player as p0')
          .whereRef('p0.matchId', '=', 'Match.id')
          .select('p0.id');

        const applyConditions = (
          query: any,
          filter: SearchMatchesDto['filters'][0],
          idx: number,
        ) => {
          const alias = `p${idx}`;
          if (filter.playerId) {
            query = query.where(
              `${alias}.platformPlayerId`,
              '=',
              filter.playerId,
            );
          }
          if (filter.race) {
            query = query.where(`${alias}.raceId`, '=', filter.race);
          }
          if (filter.place) {
            query = query.where(`${alias}.place`, '=', filter.place);
          }
          if (filter.bonus) {
            const bonusAlias = `pd${idx}`;
            query = query
              .innerJoin(
                `PlayerData as ${bonusAlias}`,
                `${bonusAlias}.playerId`,
                `${alias}.id`,
              )
              .where(
                `${bonusAlias}.type`,
                '=',
                sql<PlayerDataType>`${PlayerDataType.BONUS}::"PlayerDataType"`,
              )
              .where(`${bonusAlias}.value`, '=', filter.bonus);
          }
          return query;
        };

        sub = applyConditions(sub, dto.filters[0], 0);

        for (let i = 1; i < dto.filters.length; i++) {
          const alias = `p${i}`;
          sub = sub.innerJoin(`Player as ${alias}`, (join: any) => {
            let j = join.onRef(`${alias}.matchId`, '=', 'Match.id');
            for (let k = 0; k < i; k++) {
              j = j.onRef(`${alias}.id`, '!=', `p${k}.id`);
            }
            return j;
          });
          sub = applyConditions(sub, dto.filters[i], i);
        }

        return eb.exists(sub);
      }) as unknown as typeof baseQuery;
    }

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
            ])
            .$if(dto.events, (q) =>
              q.select((sp) => [
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
              ]),
            )
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

  public async getMatchEvents(id: bigint) {
    const query = this.kysely
      .selectFrom('Player as p')
      // @ts-expect-error kysely typings
      .where('p.matchId', '=', id)
      .select((sp) => [
        'p.id as playerId',
        jsonArrayFrom(
          sp
            .selectFrom('PlayerEvent as pe')
            .whereRef('pe.playerMatchId', '=', 'p.id')
            .select(['pe.eventId as id', 'pe.eventType as type', 'pe.time'])
            .orderBy('time'),
        ).as('events'),
      ]);

    return query.execute();
  }
}
