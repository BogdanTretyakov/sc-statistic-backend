import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import type { BaseAnalyticDto, BaseRaceDto } from './lib/dto';
import { PlayerEvents, ProcessError } from '@prisma/client';
import { groupBy, mapValues } from 'lodash';
import { DumpService } from './dump.service';
import { matchFilter, playerFilter } from './lib/prisma';
import { KyselyService } from 'src/common/kysely.service';
import { sql, type CaseWhenBuilder } from 'kysely';
import { addMatchFilter, addPlayerWhere } from './lib/kysely';
import { isNotNil } from 'src/pipeline/lib/guards';
import type { DB } from 'src/common/types/kysely';

@Injectable()
export class AnalyticRepository {
  constructor(
    private prisma: PrismaService,
    private dumpService: DumpService,
    private kysely: KyselyService,
  ) {}

  async getMetaData() {
    const { endAt: lastMatchTime } = (await this.prisma.match.findFirst({
      orderBy: {
        endAt: 'desc',
      },
      select: {
        endAt: true,
      },
    }))!;

    const matchesCount = await this.prisma.match.count();

    const maps = await this.prisma.mapVersion.findMany({
      where: {
        ignore: false,
        dataKey: { not: null },
      },
      select: {
        dataKey: true,
      },
      distinct: ['dataKey'],
    });

    const withoutMapping = await this.prisma.mapProcess.count({
      where: {
        mappingError: ProcessError.NO_MAPPING,
        map: {
          ignore: false,
        },
      },
    });

    return {
      lastMatchTime,
      filters: {
        maps: maps.map(({ dataKey }) => dataKey).filter(isNotNil),
      },
      matchesCount,
      hasPatches: !!withoutMapping,
      dumpUpdateAt: (await this.dumpService.getLastDump())?.date ?? null,
    };
  }

  async getPatchMetaData(dto: BaseAnalyticDto) {
    const where = matchFilter(dto);
    const matchesCount = await this.prisma.match.count({
      where,
    });
    const { endAt: lastMatchTime } =
      (await this.prisma.match.findFirst({
        where,
        orderBy: {
          endAt: 'desc',
        },
        select: {
          endAt: true,
        },
      })) ?? {};
    const data = await this.prisma.match.aggregate({
      where,
      _min: { duration: true, endAt: true, avgMmr: true },
      _max: { duration: true, endAt: true, avgMmr: true },
      _avg: { duration: true, avgMmr: true },
    });

    let lowerUpperDurationQuery = this.kysely
      .selectFrom('Match')
      .select((s) => [
        sql<number>`COALESCE(percentile_cont(0.04) WITHIN GROUP (ORDER BY ${s.ref('Match.duration')}), 0)`.as(
          'lower',
        ),
        sql<number>`COALESCE(percentile_cont(0.96) WITHIN GROUP (ORDER BY ${s.ref('Match.duration')}), 0)`.as(
          'upper',
        ),
      ]);

    lowerUpperDurationQuery = addMatchFilter(dto, lowerUpperDurationQuery);

    const { lower, upper } =
      (await lowerUpperDurationQuery.executeTakeFirst()) ?? {
        lower: 0,
        upper: 0,
      };
    const filters = {
      duration: [Math.round(lower ?? 0), Math.round(upper ?? 0)] as const,
      endAt: [data._min.endAt, data._max.endAt] as const,
      avgMmr: [data._min.avgMmr, data._max.avgMmr] as const,
    };
    const races = await this.prisma.player.findMany({
      where: {
        match: where,
      },
      distinct: ['raceId'],
      select: {
        raceId: true,
      },
    });

    return {
      lastMatchTime,
      matchesCount,
      filters,
      races: races.map(({ raceId }) => raceId),
      avgMmr: Math.round(data._avg.avgMmr ?? 0),
      avgDuration: Math.round(data._avg.duration ?? 0),
      minDuration: Math.round(data._min.duration ?? 0),
      maxDuration: Math.round(data._max.duration ?? 0),
    };
  }

  private async getRaceStats(dto: BaseAnalyticDto) {
    const whereMatch = matchFilter(dto);

    const eventsIn = [
      PlayerEvents.INITIAL_RACE,
      PlayerEvents.REPICK_RACE,
      PlayerEvents.BAN_RACE,
    ];

    const eventCounts = await this.prisma.playerEvent.groupBy({
      by: ['eventId', 'eventType'],
      where: {
        eventType: { in: eventsIn },
        player: {
          match: whereMatch,
        },
      },
      _count: { _all: true },
    });

    const players = await this.prisma.player.groupBy({
      by: ['raceId', 'place'],
      where: {
        match: whereMatch,
      },
      _count: { _all: true },
    });

    if (!players.length) return [];

    const totalPlayers = players.reduce((a, b) => a + b._count._all, 0);

    const grouped: Record<
      string,
      {
        totalMatches: number;
        picks: number;
        wins: number;
        init: number;
        repicks: number;
        bans: number;
        places: Record<number, number>;
      }
    > = {};

    const createEmptyGroup = (key: string) => {
      if (grouped[key]) return;
      grouped[key] = {
        totalMatches: 0,
        picks: 0,
        wins: 0,
        init: 0,
        repicks: 0,
        bans: 0,
        places: {},
      };
    };

    for (const p of players) {
      createEmptyGroup(p.raceId);
      const obj = grouped[p.raceId];
      obj.totalMatches += p._count._all;
      obj.picks += p._count._all;
      obj.places[p.place] = p._count._all;
      if (p.place === 1) obj.wins = p._count._all;
    }

    for (const r of eventCounts) {
      createEmptyGroup(r.eventId);
      let key = '';
      switch (r.eventType) {
        case PlayerEvents.INITIAL_RACE:
          key = 'init';
          break;
        case PlayerEvents.REPICK_RACE:
          key = 'repicks';
          break;
        case PlayerEvents.BAN_RACE:
          key = 'bans';
          break;
        default:
          break;
      }
      if (key) {
        grouped[r.eventId][key] = r._count._all;
      }
    }

    const totalMatches = await this.prisma.match.count({
      where: whereMatch,
    });

    return Object.entries(grouped).map(([race, data]) => ({
      race,
      totalMatches: data.totalMatches,
      pickrate: +((data.picks / totalPlayers) * 100).toFixed(2),
      winrate: +((data.wins / (data.picks || 1)) * 100).toFixed(2),
      repickrate: data.init
        ? +((data.repicks / data.init) * 100).toFixed(2)
        : 0,
      banrate:
        totalMatches > 0 ? +((data.bans / totalMatches) * 100).toFixed(2) : 0,
      places: mapValues(
        data.places,
        (val) => +((val / data.picks) * 100).toFixed(2),
      ),
    }));
  }

  private async getRacesStatsByQuantile(dto: BaseAnalyticDto) {
    const { quantile_from, quantile_to, ...restDto } = dto;
    const quantileSteps = [10, 20, 40, 50, 60, 70, 75, 80, 85, 90];

    const query = this.kysely
      .selectFrom('Player')
      .innerJoin('Match', 'Match.id', 'Player.matchId')
      .$call((qb) => addMatchFilter(restDto, qb))
      .select((q) => [
        (q) => {
          let caseBuilder = q.case() as unknown as CaseWhenBuilder<
            DB,
            'Match' | 'Player',
            unknown,
            number
          >;
          quantileSteps.forEach((step, idx, arr) => {
            if (!idx) return;
            caseBuilder = caseBuilder
              .when(q.ref('Match.avgQuantile'), '<=', step)
              .then(arr[idx - 1]);
          });
          return caseBuilder.else(100).end().as('quantile_group');
        },
        'Player.raceId',
        q
          .cast<number>(
            q.fn.sum<bigint>((s) =>
              s
                .case()
                .when(q.ref('Player.place'), '=', 1)
                .then(1)
                .else(0)
                .end(),
            ),
            'integer',
          )

          .as('wins'),
        q.cast<number>(q.fn.count<bigint>('Match.id'), 'integer').as('total'),
      ])
      .groupBy(['quantile_group', 'Player.raceId'])
      .orderBy('quantile_group')
      .orderBy('Player.raceId');

    const data = await query.execute();

    return Object.values(
      mapValues(
        groupBy(data, (d) => d.raceId),
        (val, race) => ({
          race,
          winrate: val.map(({ wins }, idx) => {
            const total = val[idx]?.total || 0;
            if (!total) return null;
            return +((wins / total) * 100).toFixed(2) || null;
          }),
          quantile: val.map(({ quantile_group }) => quantile_group),
          totalMatches: val.map(({ total }) => total),
        }),
      ),
    );
  }

  private async getMatchesCountByQuantile(dto: BaseAnalyticDto) {
    const { quantile_from, quantile_to, ...restDto } = dto;

    const data = await this.prisma.match.groupBy({
      by: ['avgQuantile'],
      _count: { avgQuantile: true },
      where: matchFilter(restDto),
      orderBy: { avgQuantile: 'asc' },
      having: {
        avgQuantile: {
          not: null,
        },
      },
    });

    return data.map(
      ({ avgQuantile, _count: { avgQuantile: count } }) =>
        [avgQuantile, count] as const,
    );
  }

  async getRacesData(dto: BaseAnalyticDto) {
    const [racesData, groupedRacesWinrate, matchesByQuantile] =
      await Promise.all([
        this.getRaceStats(dto),
        this.getRacesStatsByQuantile(dto),
        this.getMatchesCountByQuantile(dto),
      ]);

    return { racesData, groupedRacesWinrate, matchesByQuantile };
  }

  private async getBonusStats(dto: BaseRaceDto) {
    const whereMatch = matchFilter(dto);
    const wherePlayer = playerFilter(dto);

    const playerGroups = await this.prisma.player.groupBy({
      by: ['bonusId', 'place'],
      _count: { _all: true },
      where: {
        ...wherePlayer,
        match: whereMatch,
        bonusId: { not: null },
      },
    });

    const countByBonus = playerGroups.reduce<Record<string, number>>(
      (acc, { bonusId, _count: { _all } }) => {
        if (!bonusId) return acc;
        if (!acc[bonusId]) acc[bonusId] = 0;
        acc[bonusId] += _all;
        return acc;
      },
      {},
    );

    const totalPlayers = await this.prisma.player.count({
      where: {
        ...wherePlayer,
        match: whereMatch,
        bonusId: { not: null },
      },
    });

    const bonusMap: Record<
      string,
      { pickrate: number; places: Record<number, number>; count: number }
    > = {};

    for (const row of playerGroups) {
      const count = countByBonus[row.bonusId ?? ''] ?? 0;
      if (!bonusMap[row.bonusId!]) {
        bonusMap[row.bonusId!] = {
          pickrate: 0,
          places: { 1: 0, 2: 0, 3: 0, 4: 0 },
          count,
        };
      }

      if (!count) continue;
      bonusMap[row.bonusId ?? ''].places[row.place] =
        (row._count._all / count) * 100;
    }

    for (const bonusId in bonusMap) {
      const data = bonusMap[bonusId];
      const totalBonusCount = playerGroups
        .filter((r) => r.bonusId === bonusId)
        .reduce((sum, r) => sum + r._count._all, 0);
      data.pickrate = (totalBonusCount / totalPlayers) * 100;
    }

    return Object.entries(bonusMap).map(([bonus, stats]) => ({
      bonus,
      matchesCount: stats.count,
      pickrate: +stats.pickrate.toFixed(2),
      winrate: +stats.places[1].toFixed(2),
      places: Object.fromEntries(
        Object.entries(stats.places).map(([k, v]) => [k, +v.toFixed(2)]),
      ),
    }));
  }

  private async getUpgradeHeatmap<const T extends PlayerEvents[]>(
    dto: BaseRaceDto,
    eventType: T,
  ) {
    const query = this.kysely
      .with('lvlEvent', (db) => {
        const query = db
          .selectFrom('PlayerEvent as pe')
          .select([
            'pe.playerMatchId',
            'pe.eventType',
            'pe.time',
            'pe.eventId',
            sql<number>`ROW_NUMBER() OVER (
              PARTITION BY
                  pe."playerMatchId",
                  pe."eventType",
                  pe."eventId"
              ORDER BY
                  pe."time" ASC
          )`.as('level'),
          ])
          .where(
            'pe.eventType',
            'in',
            eventType.map((type) => sql<PlayerEvents>`${type}::"PlayerEvents"`),
          )
          .innerJoin('Player', 'pe.playerMatchId', 'Player.id');

        return addPlayerWhere(dto, query);
      })
      .selectFrom('lvlEvent')
      .select(({ fn }) => [
        'lvlEvent.eventId',
        'lvlEvent.eventType',
        'lvlEvent.level',
        sql<number>`ROUND(${fn.avg('lvlEvent.time')})::Int`.as('avgTime'),
      ])
      .groupBy(['lvlEvent.eventType', 'lvlEvent.eventId', 'lvlEvent.level'])
      .orderBy('lvlEvent.eventId')
      .orderBy('lvlEvent.level', 'asc');

    const rawHeatmap = await query.execute();

    // Record<eventId, Record<level, avg_time>>
    const heatmap = {} as Record<string, Record<number, number>>;

    rawHeatmap.forEach((row) => {
      if (!heatmap[row.eventId]) {
        heatmap[row.eventId] = {};
      }

      heatmap[row.eventId][row.level] = row.avgTime;
    });

    return heatmap;
  }

  private async getHeroBuyStats(dto: BaseRaceDto) {
    const query = addPlayerWhere(
      dto,
      this.kysely
        .selectFrom('PlayerEvent')
        .innerJoin('Player', 'PlayerEvent.playerMatchId', 'Player.id')
        .innerJoin('Match as m', 'Player.matchId', 'm.id')
        .innerJoinLateral(
          (eb) =>
            eb
              .selectFrom('PlayerEvent as pe')
              .select((s) => [s.fn.min(s.ref('pe.time')).as('firstBuyTime')])
              .where(
                'pe.eventType',
                '=',
                sql<PlayerEvents>`${PlayerEvents.HERO_BUY}::"PlayerEvents"`,
              )
              .whereRef('pe.eventId', '=', 'PlayerEvent.eventId')
              .whereRef('pe.playerMatchId', '=', 'PlayerEvent.playerMatchId')
              .as('first'),
          (join) => join.onTrue(),
        )
        .select((s) => [
          'PlayerEvent.eventId as heroId',
          sql<number>`COUNT(*)::float / NULLIF(COUNT(DISTINCT ${s.ref('m.id')}), 0)`.as(
            'avgCount',
          ),
          s.fn.avg('first.firstBuyTime').$castTo<number>().as('avgFirstBuySec'),
        ]),
    )
      .where(
        'PlayerEvent.eventType',
        '=',
        sql<PlayerEvents>`${PlayerEvents.HERO_BUY}::"PlayerEvents"`,
      )
      .groupBy('PlayerEvent.eventId')
      .orderBy('avgCount', 'desc');

    const data = await query.execute();

    return data.map((d) => ({
      hero: d.heroId,
      avgCount: +d.avgCount.toFixed(2),
      avgFirstBuy: d.avgFirstBuySec ? Math.round(d.avgFirstBuySec ?? 0) : null,
    }));
  }

  async getRaceData(dto: BaseRaceDto) {
    const matchWhere = matchFilter(dto);
    const wherePlayer = playerFilter(dto);
    const matchesCount = await this.prisma.match.count({
      where: {
        ...matchWhere,
        players: {
          some: wherePlayer,
        },
      },
    });
    const [upgrades, towerUpgrades, buildings, heroes, bonuses] =
      await Promise.all([
        this.getUpgradeHeatmap(dto, [PlayerEvents.BASE_UPGRADE]),
        this.getUpgradeHeatmap(dto, [PlayerEvents.TOWER_UPGRADE]),
        this.getUpgradeHeatmap(dto, [
          PlayerEvents.UP_BARRACK2,
          PlayerEvents.UP_BARRACK3,
          PlayerEvents.UP_BARRACK4,
          PlayerEvents.UP_FORT2,
          PlayerEvents.UP_FORT3,
        ]),
        this.getHeroBuyStats(dto),
        this.getBonusStats(dto),
      ]);

    return {
      matchesCount,
      upgrades,
      towerUpgrades,
      buildings,
      heroes,
      bonuses,
    };
  }
}
