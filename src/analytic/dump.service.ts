import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression, Timeout } from '@nestjs/schedule';
import { createReadStream, createWriteStream } from 'fs';
import { access, mkdir, readdir, rm, stat } from 'fs/promises';
import { resolve } from 'path';
import archiver from 'archiver';
import { PrismaService } from 'src/common/prisma.service';
import { PlayerDataType, type DatabaseDump } from '@prisma/client';
import { nanoid } from 'nanoid';
import { noop } from 'lodash';
import { AwaitableCsv } from './lib/csvFormat';

@Injectable()
export class DumpService implements OnModuleInit {
  private logger = new Logger(DumpService.name);
  private dumpDir = resolve(process.cwd(), 'storage', 'dump');
  private dumpInterval = 18 * 60 * 60 * 1000; // hours
  private historyLimit = 2;
  private working = false;

  constructor(private prisma: PrismaService) {}

  public getLastDump() {
    return this.prisma.databaseDump.findFirst({
      orderBy: { date: 'desc' },
    });
  }

  public async getDumpStream(id: DatabaseDump['id']) {
    const path = resolve(this.dumpDir, `${id}.zip`);
    try {
      await access(path);
      const { size } = await stat(path);
      return [createReadStream(path), size] as const;
    } catch {
      this.logger.warn(`Dump file not found on disk: ${path}`);
      return [null, 0] as const;
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { waitForCompletion: true })
  @Timeout(0)
  async checkDump() {
    this.logger.verbose('Running scheduled dump check...');
    if (this.working) {
      return;
    }

    const lastDump = await this.truncateDumps();

    if (!lastDump) {
      this.logger.log('No dumps exist, creating first one...');
      await this.generateDump();
      return;
    }

    if (new Date().valueOf() > lastDump.valueOf() + this.dumpInterval) {
      this.logger.log('Dump interval exceeded, generating new dump...');
      await this.generateDump();
      return;
    }
  }

  private async truncateDumps() {
    this.logger.debug('Truncating old dumps...');
    const historyDumps = await this.prisma.databaseDump.findMany({
      orderBy: { date: 'desc' },
      take: this.historyLimit,
    });

    if (!historyDumps.length) {
      this.logger.debug('No dump history found.');
      return null;
    }

    const stayFiles = new Set(historyDumps.map(({ id }) => `${id}.zip`));
    const files = await readdir(this.dumpDir).catch(() => []);

    for (const fileName of files) {
      try {
        if (stayFiles.has(fileName)) continue;
        await rm(resolve(this.dumpDir, fileName));
        this.logger.log(`Removed old dump/temp file: ${fileName}`);
      } catch (e) {
        this.logger.warn(
          `Error removing old dump/temp file: ${fileName} (${e})`,
        );
      }
    }
    const existedDumps = Array<DatabaseDump>();

    for (const dump of historyDumps) {
      try {
        await access(resolve(this.dumpDir, `${dump.id}.zip`));
        existedDumps.push(dump);
      } catch (e) {
        //
      }
    }

    await this.prisma.databaseDump.deleteMany({
      where: {
        id: {
          notIn: existedDumps.map(({ id }) => id),
        },
      },
    });

    return existedDumps[0]?.date ?? null;
  }

  private async createDumpFiles() {
    const matchPath = resolve(this.dumpDir, nanoid());
    const playerPath = resolve(this.dumpDir, nanoid());
    const eventPath = resolve(this.dumpDir, nanoid());

    const matchCsv = new AwaitableCsv({ headers: true }, matchPath);
    const playerCsv = new AwaitableCsv({ headers: true }, playerPath);
    const eventCsv = new AwaitableCsv({ headers: true }, eventPath);

    try {
      const totalMatches = await this.prisma.match.count();

      let lastId = 0n;
      let fetched = 0;
      while (true) {
        if (fetched % 1000 === 0) {
          this.logger.debug(`Dumping ${lastId} of ${totalMatches} matches...`);
        }

        const matches = await this.prisma.match.findMany({
          orderBy: [{ id: 'asc' }],
          include: {
            players: { include: { events: true, playerDatas: true } },
            map: {
              select: {
                dataKey: true,
              },
            },
            mapProcess: {
              select: { platform: true },
            },
          },
          take: 100,
          cursor: lastId ? { id: lastId } : undefined,
          skip: lastId ? 1 : 0,
        });

        if (!matches.length) {
          break;
        }
        fetched += matches.length;
        lastId = matches[matches.length - 1].id;

        for (const match of matches) {
          const [mapType, mapVersion] = (match.map.dataKey ?? '').split('_');
          await matchCsv.writeDrain({
            id: match.id,
            duration: match.duration,
            avgMmr: match.avgMmr,
            avgQuantile: match.avgQuantile,
            hasLeavers: match.hasLeavers,
            platform: match.mapProcess?.platform,
            mapType,
            mapVersion,
          });

          for (const player of match.players) {
            await playerCsv.writeDrain({
              id: player.id,
              matchId: player.matchId,
              mmr: player.mmr,
              quantile: player.quantile,
              place: player.place,
              raceId: player.raceId,
              bonusId: player.playerDatas
                .filter(({ type }) => type === PlayerDataType.BONUS)
                .join(','),
              ultimateId: player.playerDatas
                .filter(({ type }) => type === PlayerDataType.ULTIMATE)
                .join(','),
            });

            for (const event of player.events) {
              await eventCsv.writeDrain({
                playerMatchId: event.playerMatchId,
                eventType: event.eventType,
                eventId: event.eventId,
                time: event.time,
              });
            }
          }
        }
      }
      await Promise.all([
        matchCsv.finalize(),
        playerCsv.finalize(),
        eventCsv.finalize(),
      ]);
      return { matchPath, playerPath, eventPath };
    } catch (e) {
      this.logger.error(
        `Got error while reading database: ${e instanceof Error ? e.message : e}`,
      );
      [matchCsv, playerCsv, eventCsv].forEach((stream) => stream.destroy(e));
      throw e;
    }
  }

  private async generateDump(): Promise<Date> {
    if (this.working) {
      this.logger.warn('Attempt to start dump while already working.');
      throw new AlreadyWorkingError();
    }
    this.logger.log('Starting dump generation...');

    this.working = true;

    try {
      const { matchPath, playerPath, eventPath } = await this.createDumpFiles();
      this.logger.log('Dump files created. Archiving...');

      const date = new Date();
      const newDump = await this.prisma.databaseDump.create({ data: { date } });
      const fileName = `${newDump.id}.zip`;

      const zip = archiver('zip', { zlib: { level: 8 } });
      const output = createWriteStream(resolve(this.dumpDir, fileName));
      zip.pipe(output);
      zip.append(createReadStream(matchPath), { name: 'matches.csv' });
      zip.append(createReadStream(playerPath), { name: 'players.csv' });
      zip.append(createReadStream(eventPath), { name: 'events.csv' });

      await zip.finalize();

      this.logger.log(`Dump created successfully: ${fileName}`);

      await rm(matchPath).catch(noop);
      await rm(playerPath).catch(noop);
      await rm(eventPath).catch(noop);

      return date;
    } catch (e) {
      this.logger.error(
        `Failed to generate dump: ${e instanceof Error ? e.message : e}`,
      );
      throw e;
    } finally {
      this.working = false;
    }
  }

  async onModuleInit() {
    await mkdir(this.dumpDir, { recursive: true });
  }
}

class AlreadyWorkingError extends Error {}
