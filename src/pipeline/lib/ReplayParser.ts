import { PlayerEvents, type PrismaClient } from '@prisma/client';
import { readFile } from 'fs/promises';
import { GameDataParser, MetadataParser, RawParser } from 'w3gjs';
import type { GameDataBlock } from 'w3gjs/dist/types/parsers/GameDataParser';
import type { ReplayMetadata } from 'w3gjs/dist/types/parsers/MetadataParser';
import type { Action } from 'w3gjs/dist/types/parsers/ActionParser';
import type { WikiDataService } from 'src/common/wikiData.service';
import type { WikiDataMapping } from 'src/common/types/wikiData';
import { SAME_EVENT_LAG } from './const';
import { isLeaveGameBlock, isTimeslotBlock } from './guards';
import type { TaggedMemoryCache } from 'src/common/tagCacheManager.service';

type InternalEvent = {
  eventType: PlayerEvents;
  eventId: string;
  time: number;
  cancelled?: boolean;
};

export type PlayerState = {
  playerId: number;
  playerName: string;
  race: string;
  raceFinalized: boolean;
  bonus: string | null;
  ultimate: string | null;
  aura: string | null;
  events: InternalEvent[];
  time: number;
  place: number;
  leaved: boolean;
};

const gameIdCache = new Map<string, string | null>();
function toGameId(val: number[]): string | null {
  if (val.length === 4) {
    const key = val.join(',');
    if (gameIdCache.has(key)) return gameIdCache.get(key) as string | null;
    const output = String.fromCharCode(...val)
      .replace(/[^\w]/g, '')
      .split('')
      .reverse()
      .join('');
    const result = output.length === 4 ? output : null;
    gameIdCache.set(key, result);
    return result;
  }
  if (val.length === 2) {
    let [, value] = val;
    let output = '';
    while (value > 8) {
      const char = value % 256;
      value = (value - char) / 256;
      output = String.fromCharCode(char) + output;
    }
    return output.length === 4 ? output : null;
  }
  return null;
}

export class ReplayMappingError {
  constructor(
    public mapId: number,
    public mapName: string,
  ) {}
}
export class BadMapError extends Error {}
export class ReplayParsingError extends Error {}

export class ReplayParser {
  private duration = 0;
  private playersMap = new Map<number, PlayerState>();
  private metadata!: ReplayMetadata;
  private gameData!: WikiDataMapping;
  private mapType!: string;

  private lookup = {
    auras: new Set<string>(),
    heroes: new Set<string>(),
    bonuses: new Set<string>(),
    barrack: new Map<string, PlayerEvents>(),
    baseUpgrades: new Set<string>(),
    towerUpgrades: new Set<string>(),
    fort: new Map<string, PlayerEvents>(),
    ultimates: {} as Record<string, string>,
    raceByPicker: new Map<string, string>(),
    raceByUnit: new Map<string, string>(),
    bonusByUnit: new Map<string, string>(),
  };

  constructor(
    private filePath: string,
    private prisma: PrismaClient,
    private wikiData: WikiDataService,
    private cache: TaggedMemoryCache,
  ) {}

  private async parseMetadata(): Promise<ReplayMetadata> {
    const buffer = await readFile(this.filePath);
    const rawParser = new RawParser();
    const rawResult = await rawParser.parse(buffer);
    const metadataParser = new MetadataParser();
    const metadata = await metadataParser.parse(rawResult.blocks);

    this.metadata = metadata;
    metadata.playerRecords.forEach((pr) =>
      this.playersMap.set(pr.playerId, {
        playerId: pr.playerId,
        playerName: pr.playerName,
        race: '',
        raceFinalized: false,
        bonus: null,
        ultimate: null,
        aura: null,
        events: [],
        time: 0,
        place: 0,
        leaved: false,
      }),
    );

    return metadata;
  }

  private buildLookup(): typeof this.lookup {
    return {
      auras: new Set(
        Object.values(this.gameData.raceData).flatMap((r) => r.auras),
      ),
      bonuses: new Set(
        Object.values(this.gameData.raceData).flatMap((r) => r.bonuses),
      ),
      heroes: new Set(
        Object.values(this.gameData.raceData).flatMap((r) => r.heroes),
      ),
      barrack: new Map(
        Object.values(this.gameData.raceData).flatMap((r) =>
          r.buildings.barrack
            .slice(-3)
            .map(
              (id, idx) =>
                [
                  id,
                  [
                    PlayerEvents.UP_BARRACK2,
                    PlayerEvents.UP_BARRACK3,
                    PlayerEvents.UP_BARRACK4,
                  ][idx],
                ] as const,
            ),
        ),
      ),
      baseUpgrades: new Set(
        Object.values(this.gameData.raceData).flatMap((r) =>
          Object.values(r.baseUpgrades).concat(...r.magic),
        ),
      ),
      towerUpgrades: new Set(
        Object.values(this.gameData.raceData).flatMap((r) => r.towerUpgrades),
      ),
      fort: new Map(
        Object.values(this.gameData.raceData).flatMap((r) =>
          r.buildings.fort
            .slice(-2)
            .map(
              (id, idx) =>
                [
                  id,
                  [PlayerEvents.UP_FORT2, PlayerEvents.UP_FORT3][idx],
                ] as const,
            ),
        ),
      ),
      ultimates: Object.fromEntries(
        Object.entries(this.gameData.ultimates).flatMap(([key, val]) => [
          [key, key],
          ...val.map((id) => [id, key]),
        ]),
      ) as Record<string, string>,
      raceByPicker: new Map(
        Object.values(this.gameData.raceData).map((val) => [
          val.bonusPicker,
          val.id,
        ]),
      ),
      raceByUnit: new Map(
        Object.values(this.gameData.raceData).flatMap((r) =>
          [
            r.heroes,
            Object.values(r.units),
            Object.values(r.buildings).flatMap((b) =>
              Array.isArray(b) ? b : [b],
            ),
          ].flatMap((items) => items.map((id) => [id, r.id])),
        ),
      ),
      bonusByUnit: new Map(
        Object.values(this.gameData.raceData).flatMap((r) =>
          Object.entries(r.bonusByItemId),
        ),
      ),
    };
  }

  private async parseGameData() {
    const mapName = this.metadata.map.mapName.split(/[\\/]/g).pop();
    if (!mapName) throw new BadMapError();

    const mapProcess = await this.prisma.mapProcess
      .update({
        where: { filePath: this.filePath.split(/[\\/]/g).pop() || '' },
        data: {
          map: {
            connectOrCreate: {
              where: { mapName },
              create: { mapName },
            },
          },
        },
        include: { map: true },
      })
      .catch(() => null);

    const mapVersion = mapProcess?.map;

    if (!mapVersion) {
      throw new Error("Prisma can't connect map version, lol");
    }

    if (
      !mapVersion.dataKey ||
      !mapVersion.mapType ||
      !this.wikiData.data[mapVersion.dataKey]
    ) {
      await this.prisma.mapVersion.update({
        where: { id: mapVersion.id },
        data: { dataKey: null },
      });
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw new ReplayMappingError(mapVersion.id, mapName);
    }

    this.mapType = mapVersion.mapType;

    this.gameData = this.wikiData.data[mapVersion.dataKey];

    this.lookup = this.cache.wrap(
      ['parserLookup', mapVersion.dataKey],
      () => this.buildLookup(),
      ['wikiData'],
    );
  }

  private processRacePick(pickerId: string, playerState: PlayerState) {
    if (!pickerId) return;
    const raceId = this.lookup.raceByPicker.get(pickerId);
    if (!raceId) return;

    const prevRace = playerState.race;
    playerState.race = raceId;

    if (!prevRace) {
      this.insertEvent(playerState, {
        eventId: raceId,
        eventType: PlayerEvents.INITIAL_RACE,
        time: 0,
      });
    }

    if (prevRace && prevRace !== raceId) {
      playerState.raceFinalized = true;
      this.insertEvent(playerState, {
        eventId: prevRace,
        eventType: PlayerEvents.REPICK_RACE,
        time: this.duration,
      });
    }
  }

  private processBonusPick(id: string, playerState: PlayerState) {
    if (!id || !playerState.race) return;

    const race = this.gameData.raceData[playerState.race];
    if (!race || !race.bonuses.includes(id)) return;

    playerState.bonus = id;
  }

  private processMMD(action: Action, playerState: PlayerState) {
    switch (this.mapType) {
      case 'oz':
        this.processMMDtypeOZ(action, playerState);
        break;
    }
  }

  private processMMDtypeOZ(action: Action, playerState: PlayerState) {
    if (action.id !== 0x6b) return;
    const key = action.cache?.key.trim().slice(-4);
    if (!key || key.length !== 4) return;
    const race = this.gameData.races[playerState.race];
    if (!race) return;

    const ultiKey = this.lookup.ultimates[key];
    if (key in this.lookup.ultimates) {
      playerState.ultimate = ultiKey;
      if (key !== ultiKey) {
        this.insertEvent(playerState, {
          eventId: ultiKey,
          eventType: PlayerEvents.USE_ULTIMATE,
          time: this.duration,
        });
      }
    }
    if (this.lookup.auras.has(key) && race.auras.includes(key)) {
      playerState.aura = key;
    }
    if (this.lookup.bonuses.has(key) && race.bonuses.includes(key)) {
      playerState.bonus = key;
    }
  }

  private processTypeSpecificId(itemId: string, playerState: PlayerState) {
    if (this.mapType === 'og') {
      if (this.gameData.races.includes(itemId)) {
        this.insertEvent(playerState, {
          eventId: itemId,
          eventType: PlayerEvents.BAN_RACE,
          time: this.duration,
        });
      }
    }
    if (this.mapType === 'oz') {
      if (this.gameData.races.includes(itemId)) {
        playerState.race = itemId;
        playerState.raceFinalized = true;
        this.insertEvent(playerState, {
          eventId: itemId,
          eventType: PlayerEvents.INITIAL_RACE,
          time: 0,
        });
      }
    }
  }

  private lastEventTime = new Map<string, number>();
  private insertEvent(playerState: PlayerState, event: InternalEvent) {
    const { eventId, eventType, time } = event;

    const prevTime = this.lastEventTime.get(eventId);
    const lag = SAME_EVENT_LAG[eventType] ?? SAME_EVENT_LAG.default;
    if (prevTime !== undefined && time - lag < prevTime) {
      return;
    }

    this.lastEventTime.set(eventId, time);
    playerState.events.push(event);
  }

  private processRaceByUnitId(raceId: string, playerState: PlayerState) {
    if (!playerState.race) {
      playerState.race = raceId;
      this.insertEvent(playerState, {
        eventId: raceId,
        eventType: PlayerEvents.INITIAL_RACE,
        time: 0,
      });
      return;
    }
    if (playerState.race === raceId) {
      if (this.duration > 7 * 60 * 1000) {
        playerState.raceFinalized = true;
      }
      return;
    }
    this.insertEvent(playerState, {
      eventId: playerState.race,
      eventType: PlayerEvents.REPICK_RACE,
      time: this.duration,
    });
    playerState.race = raceId;
    playerState.raceFinalized = true;
  }

  private processAction(action: Action, playerId: number) {
    const playerState = this.playersMap.get(playerId);
    if (!playerState || playerState.leaved) return;
    playerState.time = this.duration;

    const itemIDs: string[] = [];
    const addObject = (ids: (number[] | undefined)[]) => {
      for (const id of ids) {
        const gid = id ? toGameId(id) : null;
        if (gid) itemIDs.push(gid);
      }
    };

    switch (action.id) {
      case 0x10:
        addObject([action.orderId]);
        break;
      case 0x11:
        addObject([action.orderId]);
        break;
      case 0x12:
        addObject([action.orderId, action.object]);
        break;
      case 0x15:
        addObject([action.orderId1, action.object]);
        break;
      case 0x19: {
        const id = toGameId(action.itemId);
        if (!id) break;
        if (this.lookup.raceByPicker.has(id) && !playerState.raceFinalized) {
          this.processRacePick(id, playerState);
        }
        // Always trying to specify bonus by building selection
        if (this.lookup.bonuses.has(id)) {
          this.processBonusPick(id, playerState);
        }
        break;
      }
      case 0x6b:
        this.processMMD(action, playerState);
        break;
      case 0x1e:
      case 0x1f: {
        const id = toGameId(action.itemId);
        if (!id) return;
        const cancelledEvent = playerState.events.findLast(
          ({ eventId }) => eventId === id,
        );
        if (cancelledEvent) {
          cancelledEvent.cancelled = true;
          const last = playerState.events.findLast(
            ({ eventId, cancelled }) => eventId === id && !cancelled,
          )?.time;
          if (last) {
            this.lastEventTime.set(id, last);
          } else {
            this.lastEventTime.delete(id);
          }
        }

        break;
      }
      default:
        break;
    }

    for (const id of itemIDs) {
      this.processTypeSpecificId(id, playerState);
      // Check race by unit buy
      if (!playerState.raceFinalized && this.lookup.raceByUnit.has(id)) {
        const newRace = this.lookup.raceByUnit.get(id)!;
        this.processRaceByUnitId(newRace, playerState);
      }
      // Trying to take bonus by itemID
      if (!playerState.bonus && this.lookup.bonusByUnit.has(id)) {
        const bonus = this.lookup.bonusByUnit.get(id)!;
        if (this.gameData.raceData[playerState.race]?.bonuses.includes(bonus)) {
          playerState.bonus = bonus;
        }
      }
      // Heroes
      if (this.lookup.heroes.has(id)) {
        this.insertEvent(playerState, {
          eventId: id,
          eventType: PlayerEvents.HERO_BUY,
          time: this.duration,
        });
      }
      // Barracks
      if (this.lookup.barrack.has(id)) {
        this.insertEvent(playerState, {
          eventId: id,
          eventType: this.lookup.barrack.get(id)!,
          time: this.duration,
        });
      }
      // Fort upgrades
      if (this.lookup.baseUpgrades.has(id)) {
        this.insertEvent(playerState, {
          eventId: id,
          eventType: PlayerEvents.BASE_UPGRADE,
          time: this.duration,
        });
      }
      // Tower upgrades
      if (this.lookup.towerUpgrades.has(id)) {
        this.insertEvent(playerState, {
          eventId: id,
          eventType: PlayerEvents.TOWER_UPGRADE,
          time: this.duration,
        });
      }
      // Fort up
      if (this.lookup.fort.has(id)) {
        this.insertEvent(playerState, {
          eventId: id,
          eventType: this.lookup.fort.get(id)!,
          time: this.duration,
        });
      }
      // Maybe get aura
      if (this.lookup.auras.has(id)) {
        playerState.aura = id;
      }
      // Maybe get ultimate
      if (this.lookup.ultimates[id]) {
        playerState.ultimate = this.lookup.ultimates[id];
      }
    }
  }

  private resultData() {
    const sortedPlayers = Array.from(this.playersMap.values())
      .filter(({ race }) => race)
      .sort((a, b) => b.time - a.time)
      .map((p, idx) => ({
        ...p,
        place: idx + 1,
        events: p.events.filter(({ cancelled }) => !cancelled),
      }));

    if (sortedPlayers.length < 2) {
      throw new ReplayParsingError(
        `Not enough players: ${sortedPlayers.length}`,
      );
    }

    return {
      players: sortedPlayers,
      duration: Math.max(
        ...Array.from(this.playersMap.values()).map(({ time }) => time),
      ),
      map: this.metadata.map.mapName.split(/[\\/]/g).pop() || '',
    };
  }

  public async parse() {
    await this.parseMetadata();
    await this.parseGameData();

    return new Promise<ReturnType<typeof this.resultData>>(
      (resolve, reject) => {
        const parser = new GameDataParser();

        parser.on('error', (err: Error) => reject(err));
        parser.on('gamedatablock', (block: GameDataBlock) => {
          if (isTimeslotBlock(block)) {
            this.duration += block.timeIncrement;
            for (const cmd of block.commandBlocks) {
              for (const action of cmd.actions) {
                this.processAction(action, cmd.playerId);
              }
            }
          }
          if (isLeaveGameBlock(block)) {
            const playerState = this.playersMap.get(block.playerId);
            if (!playerState) return;
            if (!playerState.race) {
              // Player left without race parsed
              this.playersMap.delete(block.playerId);
              playerState.leaved = true;
              playerState.time = this.duration;
            }
          }
        });

        parser
          .parse(this.metadata.gameData, this.metadata.isPost202ReplayFormat)
          .then(() => resolve(this.resultData()))
          .catch(reject);
      },
    );
  }
}
