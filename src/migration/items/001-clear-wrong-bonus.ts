import { chunk } from 'lodash';
import type { MigrationContext } from '../types';

export async function exec({ wikiData, prisma, logger }: MigrationContext) {
  const badReplays = new Set<string>();
  const badMatches = new Set<bigint>();

  const mapVersions = await prisma.mapVersion.findMany({
    where: { dataKey: { not: null } },
    select: { id: true, dataKey: true },
  });

  for (const mapVersion of mapVersions) {
    const { id: mapId, dataKey } = mapVersion;
    /** @type {import('../../common/types/wikiData').WikiDataMapping} */
    const { raceData } = wikiData.data[dataKey ?? ''] ?? {};
    if (!raceData) continue;

    for (const race of Object.values(raceData)) {
      const badRacePlayers = await prisma.player.findMany({
        where: {
          raceId: race.id,
          match: { mapId },
          bonusId: {
            not: null,
            notIn: race.bonuses,
          },
        },
        distinct: ['matchId'],
        include: {
          match: {
            include: { mapProcess: { select: { filePath: true } } },
          },
        },
      });
      for (const {
        match: {
          id: matchId,
          mapProcess: { filePath },
        },
      } of badRacePlayers) {
        badMatches.add(matchId);
        badReplays.add(filePath);
      }
    }
  }

  let removedEvents = 0;
  let removedPlayers = 0;
  let removedMatches = 0;

  for (const matchIds of chunk(Array.from(badMatches), 50)) {
    const playerIds = (
      await prisma.player.findMany({
        where: { matchId: { in: matchIds } },
        select: { id: true },
      })
    ).map(({ id }) => id);

    const { count: events } = await prisma.playerEvent.deleteMany({
      where: { playerMatchId: { in: playerIds } },
    });
    const { count: players } = await prisma.player.deleteMany({
      where: { id: { in: playerIds } },
    });

    const { count: matches } = await prisma.match.deleteMany({
      where: { id: { in: matchIds } },
    });
    removedMatches += matches;
    removedEvents += events;
    removedPlayers += players;
  }

  for (const replayNames of chunk(Array.from(badReplays), 50)) {
    await prisma.mapProcess.updateMany({
      where: { filePath: { in: replayNames } },
      data: { processed: false },
    });
  }

  logger.log(
    `Removed ${removedEvents} events, ${removedPlayers} players and ${removedMatches} matches`,
  );
}
