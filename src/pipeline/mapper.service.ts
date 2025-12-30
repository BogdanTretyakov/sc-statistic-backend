import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/common/prisma.service';
import { isAxiosError } from 'axios';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { W3CReplayRequestService } from './requests.module/w3cReplayRequest.service';
import dayjs from 'dayjs';
import { MatchPlatform } from '@prisma/client';

@Injectable()
export class MapperService implements OnModuleInit {
  private readonly logger = new Logger(MapperService.name);

  constructor(
    private prisma: PrismaService,
    private w3cRequest: W3CReplayRequestService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, {
    waitForCompletion: true,
  })
  mapMatches() {
    return Promise.all([this.processW3C()]);
  }

  private async processW3C() {
    this.logger.verbose('Cron: Downloading W3C replays');

    if (!this.w3cRequest.checkAvailable()) {
      this.logger.verbose('W3C rate limited, skipping run');
      return;
    }

    const loggerState = {
      success: 0,
      error: 0,
      limitExceeded: false,
    };

    const pending = await this.prisma.w3ChampionsMatch.findMany({
      where: {
        // There possible lag when saving at W3C side, waiting for proceed
        time: { lte: dayjs().subtract(1, 'hour').toDate() },
        OR: [
          {
            mapProcessId: null,
          },
          {
            processId: {
              downloadError: { not: 500 },
            },
          },
        ],
      },
      orderBy: {
        time: 'asc',
      },
      select: {
        id: true,
      },
    });

    try {
      for (const match of pending) {
        const fileName = `${match.id}.w3g`;
        const filePath = this.getPath(fileName);
        try {
          if (!existsSync(filePath)) {
            const { data } = await this.w3cRequest.get<Buffer>(
              `/api/replays/${match.id}`,
            );
            await writeFile(filePath, data);
          }

          const process = await this.prisma.mapProcess.upsert({
            where: { filePath: fileName },
            update: { downloadError: null },
            create: {
              filePath: fileName,
              platform: MatchPlatform.W3Champions,
            },
          });

          await this.prisma.w3ChampionsMatch.update({
            where: { id: match.id },
            data: {
              processId: {
                connect: {
                  id: process.id,
                },
              },
            },
          });
          this.logger.verbose(`Mapped replay ${match.id}`);
          loggerState.success++;
        } catch (error) {
          if (isAxiosError(error)) {
            if (error.response?.status === 401) {
              this.logger.error(
                `Unauthorized while downloading replay ${match.id}`,
              );
              throw new Error('Unauthorized');
            }
            if (error.response?.status === 429) {
              this.logger.warn(
                `Got 429, rate limit exceeded. Skipping until hour end`,
              );
              loggerState.limitExceeded = true;
              return;
            }
            if (error.response?.status) {
              const process = await this.prisma.mapProcess.upsert({
                where: { filePath: fileName },
                update: { downloadError: error.response.status },
                create: {
                  filePath: fileName,
                  platform: MatchPlatform.W3Champions,
                  downloadError: error.response.status,
                },
              });

              await this.prisma.w3ChampionsMatch.update({
                where: { id: match.id },
                data: {
                  processId: {
                    connect: {
                      id: process.id,
                    },
                  },
                },
              });

              loggerState.error++;

              this.logger.error(
                `W3C replay ${match.id} failed with status ${error.response.status}`,
              );
            }
          }
        }
      }
    } finally {
      if (pending.length) {
        const logMessages = Array<string>();
        if (loggerState.success) {
          logMessages.push(`Mapped ${loggerState.success} W3C replays`);
        }
        if (loggerState.error) {
          logMessages.push(`Failed to map ${loggerState.error} W3C replays`);
        }
        if (loggerState.limitExceeded) {
          const countSkipped =
            pending.length - loggerState.success - loggerState.error;
          logMessages.push(
            `Skipped ${countSkipped} W3C replays due to rate limit`,
          );
        }
        this.logger.log(logMessages.join('\n'));
      }
    }
  }

  private getPath(fileName: string) {
    return resolve(process.cwd(), 'storage', 'replays', fileName);
  }

  async onModuleInit() {
    await mkdir(resolve(process.cwd(), 'storage', 'replays'), {
      recursive: true,
    });
  }
}
