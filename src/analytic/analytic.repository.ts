import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import type { BaseAnalyticDto, BaseRaceDto } from './lib/dto';
import { PlayerEvents, ProcessError, PlayerDataType } from '@prisma/client';
import { mapValues } from 'lodash';
import { DumpService } from './dump.service';
import { matchFilter, playerFilter } from './lib/prisma';
import { KyselyService } from 'src/common/kysely.service';
import { sql } from 'kysely';
import { addMatchFilter, addPlayerWhere } from './lib/kysely';
import { isNotNil } from 'src/pipeline/lib/guards';

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
    const { endAt: lastMatchTime } = await this.prisma.match
      .findFirstOrThrow({
        where,
        orderBy: {
          endAt: 'desc',
        },
        select: {
          endAt: true,
        },
      })
      .catch(() => ({ endAt: new Date(0) }));
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

    const { lower, upper } = await lowerUpperDurationQuery
      .executeTakeFirstOrThrow()
      .catch(() => ({ lower: 0, upper: 0 }));
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

    const seasons = await this.kysely
      .selectFrom('Match')
      .innerJoin('MapProcess', 'MapProcess.id', 'Match.mapProcessId')
      .innerJoin('MapVersion', 'MapProcess.mapId', 'MapVersion.id')
      .leftJoin(
        'W3ChampionsMatch',
        'W3ChampionsMatch.mapProcessId',
        'MapProcess.id',
      )
      .select((eb) => [
        'MapProcess.platform as platform',
        eb.ref('W3ChampionsMatch.season').$castTo<string>().as('season'),
        eb.fn.count('Match.id').$castTo<number>().as('matches'),
      ])
      .where('MapVersion.dataKey', '=', `${dto.type}_${dto.version}`)
      .where('W3ChampionsMatch.season', 'is not', null)
      .groupBy(['MapProcess.platform', 'W3ChampionsMatch.season'])
      .orderBy('W3ChampionsMatch.season', 'desc')
      .execute();

    return {
      lastMatchTime,
      matchesCount,
      filters,
      races: races.map(({ raceId }) => raceId),
      avgMmr: Math.round(data._avg.avgMmr ?? 0),
      avgDuration: Math.round(data._avg.duration ?? 0),
      minDuration: Math.round(data._min.duration ?? 0),
      maxDuration: Math.round(data._max.duration ?? 0),
      seasons,
    };
  }

  private async getRaceStats(dto: BaseAnalyticDto) {
    const whereMatch = matchFilter(dto);
    const playerId = dto.playerId;

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
          platformPlayerId: playerId ? { equals: playerId } : undefined,
        },
      },
      _count: { _all: true },
    });

    const players = await this.prisma.player.groupBy({
      by: ['raceId', 'place'],
      where: {
        match: whereMatch,
        platformPlayerId: playerId ? { equals: playerId } : undefined,
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

  private async getGlobalUltimatesStats(dto: BaseAnalyticDto) {
    const baseQuery = addMatchFilter(
      dto,
      this.kysely
        .selectFrom('PlayerData as pd')
        .innerJoin('Player as p', 'pd.playerId', 'p.id')
        .innerJoin('Match', 'p.matchId', 'Match.id'),
    ).where(
      'pd.type',
      '=',
      sql<PlayerDataType>`${PlayerDataType.ULTIMATE}::"PlayerDataType"`,
    );
    const totalPicks = baseQuery.select((s) =>
      s.fn.count('pd.playerId').distinct().as('total'),
    );

    const winrateQuery = this.kysely
      .selectFrom(baseQuery.select(['pd.value', 'p.place', 'Match.id']).as('b'))
      .crossJoin(totalPicks.as('t'))
      .select((s) => [
        s.ref('b.value').as('ultimateId'),
        sql<number>`COUNT(DISTINCT ${s.ref('b.id')})::float / ${s.ref('total')}`.as(
          'pickRate',
        ),
        sql<number>`COUNT(DISTINCT CASE WHEN ${s.ref('b.place')} = 1 THEN ${s.ref('b.id')} END)::float
      / NULLIF(COUNT(DISTINCT ${s.ref('b.id')}),0)`.as('winRate'),
      ])
      .groupBy(['b.value', 't.total']);

    const winrates = await winrateQuery.execute();

    return winrates
      .map(({ ultimateId, pickRate, winRate }) => {
        return {
          id: ultimateId,
          pickrate: +(pickRate * 100).toFixed(2),
          winrate: +(winRate * 100).toFixed(2),
        };
      })
      .filter(isNotNil);
  }

  private async getLeaversByQuantile(dto: BaseAnalyticDto) {
    const leaversByQuantile = addMatchFilter(
      dto,
      this.kysely.selectFrom('Match'),
      { skipLeavers: true },
    )
      .select([
        'avgQuantile as quantile',
        sql<number>`
          COUNT(*) FILTER (WHERE "hasLeavers")::float
          / NULLIF(COUNT(*), 0)
        `.as('leaverRate'),
      ])
      .groupBy('avgQuantile')
      .orderBy('avgQuantile');

    const data = await leaversByQuantile.execute();

    return data
      .filter(({ leaverRate }) => leaverRate)
      .map(
        ({ quantile, leaverRate }) =>
          [quantile, +(leaverRate * 100).toFixed(2)] as const,
      );
  }

  private async getMatchDurations(dto: BaseAnalyticDto) {
    const durationBuckets = addMatchFilter(
      dto,
      this.kysely.selectFrom('Match'),
    ).select([
      sql<number>`percentile_disc(0.1) WITHIN GROUP (ORDER BY "duration")`.as(
        '10',
      ),
      sql<number>`percentile_disc(0.2) WITHIN GROUP (ORDER BY "duration")`.as(
        '20',
      ),
      sql<number>`percentile_disc(0.3) WITHIN GROUP (ORDER BY "duration")`.as(
        '30',
      ),
      sql<number>`percentile_disc(0.4) WITHIN GROUP (ORDER BY "duration")`.as(
        '40',
      ),
      sql<number>`percentile_disc(0.5) WITHIN GROUP (ORDER BY "duration")`.as(
        '50',
      ),
      sql<number>`percentile_disc(0.6) WITHIN GROUP (ORDER BY "duration")`.as(
        '60',
      ),
      sql<number>`percentile_disc(0.7) WITHIN GROUP (ORDER BY "duration")`.as(
        '70',
      ),
      sql<number>`percentile_disc(0.8) WITHIN GROUP (ORDER BY "duration")`.as(
        '80',
      ),
      sql<number>`percentile_disc(0.9) WITHIN GROUP (ORDER BY "duration")`.as(
        '90',
      ),
    ]);

    return durationBuckets.executeTakeFirst();
  }

  private async getMatchesByHour(dto: BaseAnalyticDto) {
    const matchesByHour = addMatchFilter(dto, this.kysely.selectFrom('Match'))
      .select((s) => [
        sql<number>`EXTRACT(HOUR FROM ${s.ref('Match.endAt')})`.as('hour'),
        sql<number>`
          ROUND(
            COUNT(*)::numeric
            / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100,
            2
          )
        `.as('pctMatches'),
      ])
      .groupBy('hour')
      .orderBy('hour');

    const data = await matchesByHour.execute();

    return data.map(({ hour, pctMatches }) => [hour, pctMatches]);
  }

  private async getMatchesByDay(dto: BaseAnalyticDto) {
    const matchesByDay = addMatchFilter(dto, this.kysely.selectFrom('Match'))
      .select((s) => [
        sql<number>`EXTRACT(DOW FROM ${s.ref('Match.endAt')})`.as('weekday'), // 0 = Sunday
        sql<number>`
          ROUND(
            COUNT(*)::numeric
            / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100,
            2
          )
        `.as('pctMatches'),
      ])
      .groupBy('weekday')
      .orderBy('weekday');

    const data = await matchesByDay.execute();

    return data.map(({ weekday, pctMatches }) => [weekday, pctMatches]);
  }

  private async getPlayerPlaces(dto: BaseAnalyticDto) {
    const query = addMatchFilter(
      dto,
      this.kysely
        .selectFrom('Player')
        .innerJoin('Match', 'Player.matchId', 'Match.id'),
    )
      .$if(!!dto.playerId, (q) =>
        q.where('Player.platformPlayerId', '=', dto.playerId!),
      )
      .select((s) => [
        'Player.place as place',
        sql<number>`
            ROUND(
              COUNT(*)::numeric
              / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100,
              2
            )::float
          `.as('pct'),
        s.fn.count('Player.id').as('matchesCount'),
      ])
      .groupBy('Player.place')
      .orderBy('Player.place');

    return query.execute();
  }

  async getRacesData(dto: BaseAnalyticDto) {
    const [
      racesData,
      matchesByQuantile,
      ultimatesData,
      // leaverRate,
      matchDurations,
      // matchesByHour,
      // matchesByDay,
      playerPlaces,
    ] = await Promise.all([
      this.getRaceStats(dto),
      this.getMatchesCountByQuantile(dto),
      this.getGlobalUltimatesStats(dto),
      // this.getLeaversByQuantile(dto),
      this.getMatchDurations(dto),
      // this.getMatchesByHour(dto),
      // this.getMatchesByDay(dto),
      this.getPlayerPlaces(dto),
    ]);

    return {
      racesData,
      matchesByQuantile,
      ultimatesData,
      // leaverRate,
      matchDurations,
      // matchesByHour,
      // matchesByDay,
      playerPlaces,
    };
  }

  private async getBonusStats(dto: BaseRaceDto) {
    const whereMatch = matchFilter(dto);
    const wherePlayer = playerFilter(dto);

    const playerGroups = await this.prisma.playerData.groupBy({
      by: ['value', 'playerId'],
      where: {
        type: 'BONUS',
        player: {
          ...wherePlayer,
          match: whereMatch,
        },
      },
      _count: { _all: true },
    });

    if (!playerGroups.length) return [];

    const playersWithPlace = await this.prisma.player.findMany({
      where: {
        ...wherePlayer,
        match: whereMatch,
        playerDatas: {
          some: {
            type: 'BONUS',
          },
        },
      },
      select: {
        id: true,
        place: true,
        playerDatas: {
          where: { type: 'BONUS' },
          select: { value: true },
        },
      },
    });

    const totalPlayers = playersWithPlace.length;

    const bonusMap: Record<
      string,
      { count: number; places: Record<number, number> }
    > = {};

    for (const p of playersWithPlace) {
      for (const { value: bonus } of p.playerDatas) {
        if (!bonusMap[bonus]) {
          bonusMap[bonus] = {
            count: 0,
            places: { 1: 0, 2: 0, 3: 0, 4: 0 },
          };
        }

        bonusMap[bonus].count += 1;
        bonusMap[bonus].places[p.place] += 1;
      }
    }

    return Object.entries(bonusMap).map(([bonus, stats]) => ({
      bonus,
      matchesCount: stats.count,
      pickrate: +((stats.count / totalPlayers) * 100).toFixed(2),
      winrate: +(((stats.places[1] || 0) / (stats.count || 1)) * 100).toFixed(
        2,
      ),
      places: Object.fromEntries(
        Object.entries(stats.places).map(([k, v]) => [
          k,
          +((v / (stats.count || 1)) * 100).toFixed(2),
        ]),
      ),
    }));
  }

  private async getRacePlayerDataRates(dto: BaseRaceDto, type: PlayerDataType) {
    const baseQuery = addPlayerWhere(
      dto,
      this.kysely
        .selectFrom('PlayerData as pd')
        .innerJoin('Player', 'pd.playerId', 'Player.id')
        .innerJoin('Match as m', 'Player.matchId', 'm.id'),
    )
      .$if(type === PlayerDataType.ULTIMATE, (q) =>
        q.where(
          'pd.type',
          '=',
          sql<PlayerDataType>`${PlayerDataType.ULTIMATE}::"PlayerDataType"`,
        ),
      )
      .$if(type === PlayerDataType.AURA, (q) =>
        q.where(
          'pd.type',
          '=',
          sql<PlayerDataType>`${PlayerDataType.AURA}::"PlayerDataType"`,
        ),
      );

    const totalPicks = baseQuery.select((s) =>
      s.fn.count('pd.playerId').distinct().as('total'),
    );

    const winrateQuery = this.kysely
      .selectFrom(
        baseQuery.select(['pd.value', 'Player.place', 'm.id']).as('b'),
      )
      .crossJoin(totalPicks.as('t'))
      .select((s) => [
        s.ref('b.value').as('ultimateId'),
        sql<number>`COUNT(DISTINCT ${s.ref('b.id')})::float / ${s.ref('total')}`.as(
          'pickRate',
        ),
        sql<number>`COUNT(DISTINCT CASE WHEN ${s.ref('b.place')} = 1 THEN ${s.ref('b.id')} END)::float
      / NULLIF(COUNT(DISTINCT ${s.ref('b.id')}),0)`.as('winRate'),
      ])
      .groupBy(['b.value', 't.total']);

    const winrates = await winrateQuery.execute();

    return winrates
      .map(({ ultimateId, pickRate, winRate }) => {
        return {
          id: ultimateId,
          pickrate: +pickRate.toFixed(2),
          winrate: +winRate.toFixed(2),
        };
      })
      .filter(isNotNil);
  }

  private async getUpgradesTimeline(dto: BaseRaceDto, winnersOnly = false) {
    const BUCKET_SIZE = 60;

    const timelineQuery = addMatchFilter(
      dto,
      this.kysely
        .selectFrom('PlayerEvent as pe')
        .innerJoin('Player as p', 'pe.playerMatchId', 'p.id')
        .innerJoin('Match', 'p.matchId', 'Match.id'),
    )
      .where('pe.eventType', 'in', [
        sql<PlayerEvents>`${PlayerEvents.BASE_UPGRADE}::"PlayerEvents"`,
        sql<PlayerEvents>`${PlayerEvents.TOWER_UPGRADE}::"PlayerEvents"`,
      ])
      .where('p.raceId', '=', dto.race)
      .$if(winnersOnly, (q) => q.where('p.place', '=', 1))
      .select((s) => [
        'pe.eventId as upgradeId',
        'p.matchId',
        sql<number>`ROW_NUMBER() OVER (
          PARTITION BY ${s.ref('p.id')}, ${s.ref('pe.eventId')}
          ORDER BY ${s.ref('pe.time')}
        )`.as('entryN'),
        'pe.time as time',
      ])
      .as('eventsWithN');

    const avgTimeQuery = this.kysely
      .selectFrom(timelineQuery)
      .select([
        'upgradeId',
        'entryN',
        sql<number>`FLOOR(AVG(time / 1000)::numeric / ${BUCKET_SIZE}) * ${BUCKET_SIZE}`.as(
          'timeBucket',
        ),
      ])
      .orderBy('timeBucket', 'asc')
      .groupBy(['upgradeId', 'entryN']);

    const rows = await avgTimeQuery.execute();

    // агрегируем в объект { bucket: [upgradeIds] }
    const timeline: Record<number, string[]> = {};

    for (const row of rows) {
      const bucket = Number(row.timeBucket);
      if (!timeline[bucket]) timeline[bucket] = [];
      if (!timeline[bucket].includes(row.upgradeId))
        timeline[bucket].push(row.upgradeId);
    }

    return timeline;
  }

  private async getHeroesAvg(dto: BaseRaceDto, winnersOnly = false) {
    const perMatch = addPlayerWhere(
      dto,
      this.kysely
        .selectFrom('PlayerEvent as pe')
        .innerJoin('Player', 'pe.playerMatchId', 'Player.id')
        .innerJoin('Match as m', 'Player.matchId', 'm.id'),
    )
      .$if(winnersOnly, (q) => q.where('Player.place', '=', 1))
      .where(
        'pe.eventType',
        '=',
        sql<PlayerEvents>`${PlayerEvents.HERO_BUY}::"PlayerEvents"`,
      )
      .select((s) => [
        'm.id as matchId',
        'pe.eventId as heroId',
        s.fn.countAll<number>().as('buyCount'),
      ])
      .groupBy(['m.id', 'pe.eventId']);

    const query = this.kysely
      .selectFrom(perMatch.as('pm'))
      .select((s) => [
        'pm.heroId',
        s.fn.avg('pm.buyCount').$castTo<number>().as('avgBuysPerMatch'),
      ])
      .groupBy('pm.heroId')
      .orderBy('avgBuysPerMatch', 'desc');

    const data = await query.execute();

    return data.map(({ heroId, avgBuysPerMatch }) => ({
      id: heroId,
      avgBuysPerMatch: +avgBuysPerMatch.toFixed(2),
    }));
  }

  private async getAvgFirstHeroBuyTime(dto: BaseRaceDto, winnersOnly = false) {
    const base = addPlayerWhere(
      dto,
      this.kysely
        .selectFrom('PlayerEvent as pe')
        .innerJoin('Player', 'pe.playerMatchId', 'Player.id')
        .innerJoin('Match as m', 'Player.matchId', 'm.id'),
    )
      .where(
        'pe.eventType',
        '=',
        sql<PlayerEvents>`
      ${PlayerEvents.HERO_BUY}::"PlayerEvents"
    `,
      )
      .$if(winnersOnly, (q) => q.where('Player.place', '=', 1));

    const firstBuys = base
      .select((s) => [
        'pe.eventId as heroId',
        'Player.matchId as matchId',
        s.fn.min('pe.time').as('firstBuyTime'),
      ])
      .groupBy(['heroId', 'matchId']);

    const query = this.kysely
      .selectFrom(firstBuys.as('fb'))
      .select((s) => [
        'fb.heroId',
        s.fn.avg('fb.firstBuyTime').$castTo<number>().as('avgFirstBuyMs'),
      ])
      .groupBy('fb.heroId')
      .orderBy('avgFirstBuyMs');

    const data = await query.execute();

    return data.map(({ heroId, avgFirstBuyMs }) => ({
      id: heroId,
      time: Math.round(avgFirstBuyMs / 1000),
    }));
  }

  private async getWinrateVsRaces(dto: BaseRaceDto) {
    const baseMatches = addPlayerWhere(
      dto,
      this.kysely
        .selectFrom('Player')
        .innerJoin('Match as m', 'Player.matchId', 'm.id')
        .select((s) => [
          'Player.matchId',
          sql<boolean>`${s.ref('Player.place')} = 1`.as('isWin'),
        ]),
    );

    const opponents = this.kysely
      .selectFrom(baseMatches.as('bm'))
      .innerJoin('Player as op', 'op.matchId', 'bm.matchId')
      .where('op.raceId', '!=', dto.race)
      .select(['op.raceId as enemyRace', 'bm.matchId', 'bm.isWin']);

    const query = this.kysely
      .selectFrom(opponents.as('o'))
      .select((s) => [
        'o.enemyRace as race',
        sql<number>`(
          ROUND((COUNT(DISTINCT CASE WHEN ${s.ref('o.isWin')} THEN ${s.ref('o.matchId')} END)::numeric
            / NULLIF(COUNT(DISTINCT ${s.ref('o.matchId')}), 0)) * 100, 2)
          )::float`.as('winrate'),
        s.fn.count('o.matchId').as('matchesCount'),
      ])
      .groupBy('race');

    return query.execute();
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
    const [
      bonuses,
      ultimates,
      auras,
      // upgrades,
      // upgradesWinner,
      // heroesAvg,
      // heroesAvgWinner,
      // avgFirstHeroBuyTime,
      // avgFirstHeroBuyTimeWinner,
      winrateVsRaces,
    ] = await Promise.all([
      this.getBonusStats(dto),
      this.getRacePlayerDataRates(dto, PlayerDataType.ULTIMATE),
      this.getRacePlayerDataRates(dto, PlayerDataType.AURA),
      // this.getUpgradesTimeline(dto),
      // this.getUpgradesTimeline(dto, true),
      // this.getHeroesAvg(dto),
      // this.getHeroesAvg(dto, true),
      // this.getAvgFirstHeroBuyTime(dto),
      // this.getAvgFirstHeroBuyTime(dto, true),
      this.getWinrateVsRaces(dto),
    ]);

    return {
      matchesCount,
      bonuses,
      ultimates,
      auras,
      // upgrades,
      // upgradesWinner,
      // heroesAvg,
      // heroesAvgWinner,
      // avgFirstHeroBuyTime,
      // avgFirstHeroBuyTimeWinner,
      winrateVsRaces,
    };
  }
}
