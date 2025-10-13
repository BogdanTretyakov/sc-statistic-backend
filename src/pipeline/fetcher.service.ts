import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/common/prisma.service';
import type { W3CMatch, W3CMatches } from './types/w3champions';
import { W3CRequest } from './requests.module';
import type { AxiosInstance } from 'axios';
import { chunk } from 'lodash';

@Injectable()
export class FetcherService {
  private logger = new Logger(FetcherService.name);
  constructor(
    private prisma: PrismaService,
    @Inject(W3CRequest) private w3cRequest: AxiosInstance,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES, {
    waitForCompletion: true,
    name: 'fetch',
  })
  fetch() {
    return Promise.all([this.fetchW3Champions()]);
  }

  private async fetchW3Champions() {
    this.logger.verbose('Fetching W3C matches...');
    const ogMatches = await this.loadW3cMatches('og');
    await this.createW3CMatches(ogMatches);

    const ozMatches = await this.loadW3cMatches('oz');
    await this.createW3CMatches(ozMatches);
  }

  private async createW3CMatches(allMatches: W3CMatch[]) {
    for (const matches of chunk(allMatches, 50)) {
      await this.prisma.w3ChampionsMatch.createMany({
        data: matches.map((match) => ({
          id: match.id,
          season: String(match.season),
          time: new Date(match.endTime),
          players: match.teams.flatMap(({ players }) =>
            players.map((player) => ({
              name: player.battleTag,
              mmr: player.oldMmr,
              quantile: Math.floor(player.oldMmrQuantile * 100),
            })),
          ),
        })),
        skipDuplicates: true,
      });
    }
  }

  private async loadW3cMatches(type: 'oz' | 'og'): Promise<W3CMatch[]> {
    let gameMode = 0;
    if (type === 'og') gameMode = 1001;
    if (type === 'oz') gameMode = 1002;

    const limit = 100;

    let count = Infinity;
    let offset = 0;

    const output = Array<W3CMatch>();

    while (offset <= count) {
      if (offset) {
        this.logger.debug(
          `Fetching W3C ${type.toLocaleUpperCase()} matches, offset: ${offset} of ${count}...`,
        );
      }
      try {
        const { data } = await this.w3cRequest.get<W3CMatches>('/api/matches', {
          params: {
            gameMode,
            offset,
            limit,
          },
        });

        count = data.count;
        offset += limit;

        output.push(...data.matches);

        const dbCount = await this.prisma.w3ChampionsMatch.count({
          where: { id: { in: data.matches.map((m) => m.id) } },
        });

        if (dbCount) {
          if (output.length - dbCount) {
            this.logger.log(
              `Fetched new W3C ${type.toLocaleUpperCase()} matches: ${output.length - dbCount}`,
              `${FetcherService.name}${type.toLocaleUpperCase()}`,
            );
          }
          break;
        }
      } catch (err) {
        this.logger.error(`Error while fetching W3C matches for ${type}`);
        return [];
      }
    }

    return output;
  }
}
