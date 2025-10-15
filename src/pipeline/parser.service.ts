import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Timeout } from '@nestjs/schedule';
import { PrismaService } from 'src/common/prisma.service';
import {
  MatchPlatform,
  PlayerEvents,
  ProcessError,
  type MapProcess,
} from '@prisma/client';
import { resolve } from 'path';
import { WikiDataService } from 'src/common/wikiData.service';
import {
  BadMapError,
  ReplayMappingError,
  ReplayParser,
  ReplayParsingError,
} from './lib/ReplayParser';
import { rm } from 'fs/promises';
import { TaggedMemoryCache } from 'src/common/tagCacheManager.service';
import { isNotNil } from './lib/guards';
import { existsSync } from 'fs';
import { TIME_TO_COUNT_PLAYER_AS_LEAVER } from './lib/const';

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);

  constructor(
    private prisma: PrismaService,
    private wikiData: WikiDataService,
    private cache: TaggedMemoryCache,
  ) {}

  onModuleInit() {
    this.parseMatches();
  }

  @Cron(CronExpression.EVERY_MINUTE, {
    waitForCompletion: true,
  })
  async parseMatches() {
    let countResult = 0;

    while (countResult < 1000) {
      const replaysToParse = await this.prisma.mapProcess.findMany({
        where: {
          OR: [
            {
              downloadError: null,
              mappingError: null,
              processed: false,
            },
            {
              mappingError: ProcessError.NO_MAPPING,
              map: {
                dataKey: { not: null },
                mapVersion: { not: null },
                ignore: false,
              },
            },
          ],
        },
        take: 10,
      });

      if (!replaysToParse.length) {
        break;
      }

      for (const replay of replaysToParse) {
        const result = await this.parseMap(replay);
        if (result) {
          countResult++;
        }
      }
    }
    if (countResult) {
      this.logger.log(`Parsed ${countResult} replays`);
    }
  }

  private async getEnrichedMatchData(
    id: MapProcess['id'],
    platform: MatchPlatform,
  ) {
    const map = await this.prisma.mapVersion.findFirstOrThrow({
      where: {
        MapProcess: {
          some: {
            id,
          },
        },
      },
    });
    const output = {
      map,
      endAt: new Date(),
      players: <Record<string, { mmr: number; quantile: number }>>{},
    };

    switch (platform) {
      case MatchPlatform.W3Champions: {
        const w3championsMatch =
          await this.prisma.w3ChampionsMatch.findFirstOrThrow({
            where: {
              processId: {
                id,
              },
            },
          });
        output.endAt = new Date(w3championsMatch.time);
        w3championsMatch.players?.forEach((player) => {
          output.players[player.name] = {
            mmr: player.mmr,
            quantile: player.quantile,
          };
        });
        break;
      }
    }

    return output;
  }

  async parseMap(mapProcess: MapProcess): Promise<boolean> {
    const { id, filePath, platform } = mapProcess;
    const path = resolve(process.cwd(), 'storage', 'replays', filePath);
    if (!existsSync(path)) {
      await this.handleNonExistingMap(mapProcess);
      return false;
    }
    try {
      const parser = new ReplayParser(
        path,
        this.prisma,
        this.wikiData,
        this.cache,
      );
      const data = await parser.parse();

      const { map, endAt, players } = await this.getEnrichedMatchData(
        id,
        platform,
      );

      const [avgMmr, avgQuantile] = (() => {
        const playersArr = Object.values(players);
        if (!playersArr.length) {
          return [null, null];
        }
        return [
          playersArr.reduce((a, b) => a + b.mmr, 0) / playersArr.length,
          playersArr.reduce((a, b) => a + b.quantile, 0) / playersArr.length,
        ] as const;
      })();
      const hasLeavers =
        data.players.length < 4 ||
        data.players.some((player) => {
          return (
            player.time < TIME_TO_COUNT_PLAYER_AS_LEAVER ||
            !player.events.find(
              ({ eventType }) => eventType === PlayerEvents.UP_FORT2,
            )
          );
        });

      await this.prisma.$transaction(
        async (prisma) => {
          const match = await prisma.match.create({
            data: {
              duration: data.duration,
              avgMmr,
              avgQuantile,
              endAt,
              hasLeavers,
              mapProcess: {
                connect: { id },
              },
              map: {
                connect: { id: map.id },
              },
            },
            select: { id: true },
          });

          for (const player of data.players) {
            const platformPlayer = await prisma.platformPlayer.upsert({
              where: {
                namePlatform: {
                  name: player.playerName,
                  platform,
                },
              },
              update: {
                lastMmr: players[player.playerName]?.mmr,
              },
              create: {
                name: player.playerName,
                platform,
                lastMmr: players[player.playerName]?.mmr,
                lastSeenAt: endAt,
              },
            });

            await prisma.player.create({
              data: {
                bonusId: player.bonus,
                raceId: player.race,
                auraId: player.aura,
                ultimateId: player.ultimate,
                place: player.place,
                mmr: players[player.playerName]?.mmr ?? null,
                quantile: players[player.playerName]?.quantile ?? null,
                timeAlive: player.time,

                match: {
                  connect: {
                    id: match.id,
                  },
                },

                platformPlayer: {
                  connect: { id: platformPlayer.id },
                },

                events: {
                  createMany: {
                    data: player.events,
                    skipDuplicates: true,
                  },
                },
              },
            });
          }

          await prisma.mapProcess.update({
            where: { id },
            data: {
              mappingError: null,
              processed: true,
            },
          });
        },
        { timeout: 30000, maxWait: 20000 },
      );

      this.cache.reset([map.mapVersion].filter(isNotNil));

      this.logger.verbose(`Parsed map: ${filePath}`);

      await this.removeReplayFile(path);

      return true;
    } catch (error) {
      if (error instanceof BadMapError) {
        this.logger.error(`Bad map: ${filePath}`);
        await this.prisma.mapProcess.update({
          where: { id },
          data: { mappingError: ProcessError.BAD_MAP },
        });
        await this.removeReplayFile(path);
        return false;
      }
      if (error instanceof ReplayMappingError) {
        this.logger.warn(`Missing mapping for map: ${error.mapName}`);
        await this.prisma.mapProcess.update({
          where: { id },
          data: { mappingError: ProcessError.NO_MAPPING, mapId: error.mapId },
        });
        return false;
      }
      if (error instanceof ReplayParsingError) {
        this.logger.error(
          `Parsing error: ${error.message} for map ${filePath}`,
        );
        await this.prisma.mapProcess.update({
          where: { id },
          data: { mappingError: ProcessError.PARSING_ERROR },
        });
        await this.removeReplayFile(path);
        return false;
      }
      if (error instanceof Error) {
        this.logger.error(
          `Unhandled parser error: ${error.message} for map ${filePath}`,
        );
      }
      return false;
    }
  }

  private async removeReplayFile(filePath: string) {
    const deleteParsed = process.env.NODE_ENV === 'production';

    try {
      if (!deleteParsed) return;
      await rm(filePath, {
        force: true,
        recursive: true,
      });
      this.logger.verbose(`Removed replay file: ${filePath}`);
    } catch (e) {
      this.logger.warn(`Failed to remove replay file: ${filePath}`);
    }
  }

  private async handleNonExistingMap({ id, platform }: MapProcess) {
    switch (platform) {
      case MatchPlatform.W3Champions: {
        await this.prisma.w3ChampionsMatch.updateMany({
          where: { mapProcessId: id },
          data: {
            mapProcessId: null,
          },
        });
        break;
      }
    }
    await this.prisma.mapProcess.delete({
      where: { id },
    });
  }
}
