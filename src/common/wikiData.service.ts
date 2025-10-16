import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import type { GithubBlobFile, GithubTree } from './types/github';
import type { RaceMapping, WikiDataMapping } from './types/wikiData';
import { PrismaService } from './prisma.service';
import { groupBy, mapValues, noop } from 'lodash';
import { TaggedMemoryCache } from './tagCacheManager.service';
import { AxiosError } from 'axios';
import { isNotNil } from 'src/pipeline/lib/guards';

@Injectable()
export class WikiDataService implements OnModuleInit {
  private working = Promise.resolve();
  private skipKeys = ['artifacts', 'misc', 'changelogs'];
  private logger = new Logger(WikiDataService.name);
  private axios = axios.create({
    headers: {
      'User-Agent': 'SC Stats Fetch Service',
      Authorization: `token ${process.env.WIKI_DATA_REPO_TOKEN}`,
    },
  });

  constructor(
    private cache: TaggedMemoryCache,
    private prisma: PrismaService,
  ) {}

  private readonly repoApiUrl = `https://api.github.com/repos/${process.env.WIKI_DATA_REPO}/git/trees/master?recursive=1`;

  onModuleInit() {
    void this.updateData();
  }

  private async fetchTree() {
    const {
      data: { tree, truncated },
    } = await this.axios.get<GithubTree>(this.repoApiUrl);

    if (truncated) {
      this.logger.fatal('Rewrite WikiDataService, lol');
      // Failing parser for getting attention
      throw new Error('Too many files');
    }

    return tree
      .filter(({ path }) => {
        return path.startsWith('data') && path.endsWith('.json');
      })
      .map(({ path, sha, url }) => {
        const [, type, version, key] = path.replace(/\.[^.]*$/, '').split('/');

        if (this.skipKeys.includes(key) || this.skipKeys.includes(type)) {
          return null;
        }

        return {
          type,
          version,
          key,
          sha,
          url,
        };
      })
      .filter(isNotNil)
      .reduce(
        (acc, { type, key, version, ...data }) => {
          const dataKey = `${type}_${version}` as const;
          if (!acc[dataKey]) acc[dataKey] = {};
          acc[dataKey][key] = data;
          return acc;
        },
        {} as Record<string, Record<string, { sha: string; url: string }>>,
      );
  }

  @Cron(CronExpression.EVERY_HOUR, { waitForCompletion: true })
  async updateData() {
    await this.working;
    let resolver = noop;
    this.working = new Promise((res) => {
      resolver = res;
    });
    try {
      this.logger.log('Updating wiki data...');
      const tree = await this.fetchTree();

      const keysUpdated = new Set<string>();

      for (const [dataKey, items] of Object.entries(tree)) {
        const dbData = mapValues(
          groupBy(
            await this.prisma.wikiData.findMany({
              where: { dataKey },
            }),
            'key',
          ),
          ([val]) => val,
        );

        try {
          for (const [key, { url, sha }] of Object.entries(items)) {
            if (dbData[key]?.sha === sha) continue;

            const {
              data: { content, encoding },
            } = await this.axios.get<GithubBlobFile>(url);

            if (encoding !== 'base64') {
              throw new Error(
                `Encoding of ${dataKey}:${key} is ${encoding}, expected base64!`,
              );
            }

            const fileContent = JSON.parse(
              Buffer.from(content, 'base64').toString(),
            );
            const parsedContent = this.handleContent(key, fileContent);

            await this.prisma.wikiData.upsert({
              where: {
                dataKey_key: { dataKey, key },
              },
              update: { data: parsedContent, sha },
              create: { dataKey, key, data: parsedContent, sha },
            });

            this.logger.log(`Updated data for ${dataKey}:${key}`);
            keysUpdated.add(dataKey);
          }
        } catch (e) {
          if (e instanceof AxiosError && e.response?.status === 429) {
            this.logger.warn('Rate limit exceeded');
            if (!dbData[dataKey]) {
              // Delete not full data
              await this.prisma.wikiData.deleteMany({ where: { dataKey } });
            }
            return;
          }
          if (e instanceof Error) {
            this.logger.error(`${e.message}\nDeleting entire dataKey...`);
          } else {
            this.logger.error('Unknown error, deleting entire dataKey...');
          }

          await this.prisma.wikiData.deleteMany({ where: { dataKey } });
        }
      }

      if (keysUpdated.size) {
        this.cache.reset(['wikiData']);
        this.logger.log(
          `Updated data for ${Array.from(keysUpdated).join(', ')}`,
        );
      } else {
        this.logger.log('All data up to date');
      }
    } catch (e) {
      this.logger.error('Failed to update wiki data', e);
    } finally {
      resolver();
    }
  }

  private async uncachedGetData(dataKey: string) {
    const dbData = await this.prisma.wikiData.findMany({ where: { dataKey } });

    if (!dbData.length) {
      throw new Error('No data found');
    }

    return dbData.reduce(
      (acc, item) => {
        if (item.key in acc) {
          acc[item.key] = item.data;
        } else {
          acc.raceData[pickId(item.data)] = item.data as RaceMapping;
        }
        return acc;
      },
      {
        raceData: {},
        races: [],
        ultimates: {},
      } satisfies WikiDataMapping as WikiDataMapping,
    );
  }

  public async getData(dataKey: string) {
    await this.working;

    return this.cache.wrap(
      ['wikiData', 'data', dataKey],
      () => this.uncachedGetData(dataKey),
      ['wikiData', dataKey],
    );
  }

  private handleContent(type: string, { data }: { data: any }) {
    switch (type) {
      case 'races':
        return Object.values(data)
          .flat()
          .map(({ id }: any) => id) as string[];

      case 'ultimates':
        return Object.fromEntries(
          Object.entries(data.spells).map(([key, value]) => [
            key,
            (value as any[]).map(pickId),
          ]),
        );
      default:
        return {
          id: data.id,
          key: data.key,
          auras: data.auras.map(pickId),
          t1spell: data.t1spell.id,
          t2spell: data.t2spell.id,
          magic: data.magic.map(pickId),
          baseUpgrades: {
            melee: data.baseUpgrades.melee.id,
            armor: data.baseUpgrades.armor.id,
            range: data.baseUpgrades.range.id,
            wall: data.baseUpgrades.wall.id,
          },
          bonuses: data.bonuses.map(pickId),
          towerUpgrades: data.towerUpgrades.map(pickId),
          units: {
            melee: data.units.melee.id,
            range: data.units.range.id,
            mage: data.units.mage.id,
            siege: data.units.siege.id,
            air: data.units.air.id,
            catapult: data.units.catapult.id,
          },
          heroes: data.heroes.map(pickId),
          bonusPicker: data.bonusPickerId,
          buildings: {
            tower: data.buildings.tower.id,
            fort: data.buildings.fort.map(pickId).slice(-3),
            barrack: data.buildings.barrack.map(pickId),
          },
          bonusByItemId: Object.fromEntries(
            data.bonuses.flatMap((bonus) => {
              const items = [
                ...(bonus.units ?? []),
                ...(bonus.heroes ?? []),
                ...(bonus.upgrades ?? []),
                ...(bonus.spells ?? []),
              ].map(pickId);
              return items.map((id) => [id, bonus.id]);
            }),
          ),
        } satisfies RaceMapping;
    }
  }
}

function pickId(item: any) {
  return item.id;
}
