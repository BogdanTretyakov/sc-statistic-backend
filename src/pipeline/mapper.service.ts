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
    let reservoir = await this.w3cRequest.getLimit();

    if (!reservoir) {
      this.logger.log('W3C reservoir exceeded, skipping');
    }

    let totalSuccess = 0;

    while (reservoir) {
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
        take: reservoir,
      });

      if (!pending.length) {
        break;
      }

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
          totalSuccess++;
        } catch (error) {
          if (isAxiosError(error)) {
            if (error.response?.status === 401) {
              this.logger.error(
                `Unauthorized while downloading replay ${match.id}`,
              );
              throw new Error('Unauthorized');
            }
            if (error.response?.status === 429) {
              const dayLimit =
                await this.w3cRequest.dayLimiter.currentReservoir();
              const hourLimit =
                await this.w3cRequest.hourLimiter.currentReservoir();
              this.logger.warn(
                `Got 429, rate limit exceeded. Day limit: ${dayLimit}, hour limit: ${hourLimit}`,
              );
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

              this.logger.error(
                `W3C replay ${match.id} failed with status ${error.response.status}`,
              );
            }
          }
        }
      }
      reservoir = await this.w3cRequest.getLimit();
    }

    if (totalSuccess > 0) {
      this.logger.log(`Mapped ${totalSuccess} W3C replays`);
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
