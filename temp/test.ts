import { PlayerEvents, PrismaClient } from '@prisma/client';
import { WikiDataService } from '../src/common/wikiData.service';
import { TaggedMemoryCache } from '../src/common/tagCacheManager.service';

const prisma = new PrismaClient();
const wikiData = new WikiDataService(new TaggedMemoryCache());

async function main() {
  await wikiData.onModuleInit();
  const mapVersions = await prisma.mapVersion.findMany({
    where: { dataKey: { not: null } },
    select: { id: true, dataKey: true, mapVersion: true },
  });

  for (const mv of mapVersions) {
    if (!mv.dataKey || !wikiData.data[mv.dataKey]) {
      console.log(`⏭️ Skip ${mv.id} (${mv.dataKey}) — wikiData not found`);
      continue;
    }

    const gameData = wikiData.data[mv.dataKey];

    // --- Строим карту: unitId -> raceId ---
    const raceByUnit = new Map<string, string>();
    for (const race of Object.values(gameData.raceData)) {
      const allUnits = [
        ...Object.values(race.units),
        ...race.heroes,
        race.buildings.tower,
        ...race.buildings.fort,
        ...race.buildings.barrack,
      ];
      for (const unitId of allUnits) {
        raceByUnit.set(unitId, race.id);
      }
    }

    // --- Берём уникальные raceId, которые встречаются у игроков этой карты ---
    const playerRaces = await prisma.player.groupBy({
      by: ['raceId'],
      _count: true,
      where: { match: { mapId: mv.id }, raceId: { notIn: gameData.races } },
    });

    let totalFixed = 0;

    // --- Для каждого raceId, если это юнит, заменяем всех игроков этой карты батчем ---
    for (const row of playerRaces) {
      const { raceId } = row;
      const correctRace = raceByUnit.get(raceId);
      if (correctRace && correctRace !== raceId) {
        const result = await prisma.player.updateMany({
          where: {
            raceId,
            match: { mapId: mv.id },
          },
          data: { raceId: correctRace },
        });
        totalFixed += result.count;
      }
    }

    const events = await prisma.playerEvent.findMany({
      where: {
        player: { match: { mapId: mv.id } },
        eventType: {
          in: [
            PlayerEvents.INITIAL_RACE,
            PlayerEvents.BAN_RACE,
            PlayerEvents.REPICK_RACE,
          ],
        },
        eventId: { notIn: gameData.races },
      },
    });

    for (const event of events) {
      const correctRace = raceByUnit.get(event.eventId);
      if (correctRace && correctRace !== event.eventId) {
        await prisma.playerEvent.update({
          where: {
            playerMatchId_eventType_eventId_time: {
              eventId: event.eventId,
              eventType: event.eventType,
              playerMatchId: event.playerMatchId,
              time: event.time,
            },
          },
          data: { eventId: correctRace },
        });
        totalFixed += 1;
      }
    }

    console.log(`✅ MapVersion ${mv.mapVersion} — fixed ${totalFixed} players`);
  }

  console.log('🎉 Done.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
