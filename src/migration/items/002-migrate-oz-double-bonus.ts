import type { MigrationContext } from '../types';

export async function exec({ prisma }: MigrationContext) {
  const mapVersions = (
    await prisma.mapVersion.findMany({
      where: { dataKey: 'oz_1.57' },
      select: { id: true },
    })
  ).map(({ id }) => id);

  const matches = await prisma.match.findMany({
    where: { mapId: { in: mapVersions } },
    select: { id: true, mapProcessId: true },
  });

  const matchIDs = matches.map(({ id }) => id);

  const mapProcessIDs = matches.map(({ mapProcessId }) => mapProcessId);

  const playerIDs = (
    await prisma.player.findMany({
      where: {
        matchId: {
          in: matchIDs,
        },
      },
    })
  ).map(({ id }) => id);

  await prisma.$transaction(
    async (prisma) => {
      await prisma.playerData.deleteMany({
        where: {
          playerId: {
            in: playerIDs,
          },
        },
      });
      await prisma.playerEvent.deleteMany({
        where: {
          playerMatchId: {
            in: playerIDs,
          },
        },
      });
      await prisma.player.deleteMany({
        where: {
          id: {
            in: playerIDs,
          },
        },
      });
      await prisma.match.deleteMany({
        where: {
          id: {
            in: matchIDs,
          },
        },
      });
      await prisma.w3ChampionsMatch.deleteMany({
        where: {
          mapProcessId: {
            in: mapProcessIDs,
          },
        },
      });
      await prisma.mapProcess.deleteMany({
        where: {
          id: {
            in: mapProcessIDs,
          },
        },
      });
    },
    {
      timeout: 60000,
      maxWait: 60000,
    },
  );
}
