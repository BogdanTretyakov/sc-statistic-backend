import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { GithubBlobFile, GithubTree } from './types/github';
import { existsSync } from 'fs';
import type { RaceMapping, WikiDataMapping } from './types/wikiData';
import { TaggedMemoryCache } from './tagCacheManager.service';

@Injectable()
export class WikiDataService implements OnModuleInit {
  private _data: Record<string, WikiDataMapping> = {};
  private logger = new Logger(WikiDataService.name);
  private readonly dumpPath = resolve(process.cwd(), 'storage', 'data.json');
  private axios = axios.create({
    headers: {
      'User-Agent': 'SC Stats Fetch Service',
      Authorization: `token ${process.env.WIKI_DATA_REPO_TOKEN}`,
    },
  });

  constructor(private cache: TaggedMemoryCache) {}

  private readonly repoApiUrl = `https://api.github.com/repos/${process.env.WIKI_DATA_REPO}/git/trees/master?recursive=1`;

  async onModuleInit() {
    // сначала пытаемся загрузить дамп
    if (existsSync(this.dumpPath)) {
      try {
        const raw = await readFile(this.dumpPath, 'utf8');
        this._data = JSON.parse(raw);
        this.logger.verbose('Data loaded from dump');
      } catch (err) {
        this.logger.error('Failed to read dump');
      }
    } else {
      this.logger.warn('No wiki data dump found, fresh fetch (may be long)');
      await this.updateData();
    }
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async handleCron() {
    await this.updateData();
  }

  private async updateData() {
    try {
      this.logger.log('Updating wiki data...');
      const newData = await this.fetchFolder(this.repoApiUrl);
      this._data = newData;

      await writeFile(this.dumpPath, JSON.stringify(this._data), 'utf8');

      this.cache.reset(['wikiData']);

      this.logger.log('Data updated and saved to disk');
    } catch (err) {
      if (err instanceof Error) {
        this.logger.error(`Failed to update data: ${err.message}`);
      } else {
        this.logger.error('Failed to update data');
      }
      throw err;
    }
  }

  private async fetchFolder(url: string) {
    const {
      data: { tree, truncated },
    } = await this.axios.get<GithubTree>(url);

    if (truncated) {
      this.logger.fatal('Rewrite WikiDataService, lol');
      // Failing parser for getting attention
      this._data = {};
      throw new Error('Too many files');
    }

    return tree
      .filter(({ path }) => {
        return (
          path.startsWith('data') &&
          path.endsWith('.json') &&
          !path.includes('changelog')
        );
      })
      .reduce(
        async (prevAcc, githubFile) => {
          const acc = await prevAcc;
          const [, type, version, name] = githubFile.path
            .replace(/\.[^.]*$/, '')
            .split('/');

          if (['artifacts', 'misc'].includes(name)) {
            return acc;
          }

          const key = `${type}_${version}`;
          const {
            data: { content, encoding },
          } = await this.axios.get<GithubBlobFile>(githubFile.url);

          if (encoding !== 'base64') {
            this.logger.fatal(
              `Encoding of ${githubFile.path} is ${encoding}, expected base64!`,
            );
            return acc;
          }

          const fileContent = JSON.parse(
            Buffer.from(content, 'base64').toString(),
          );

          if (!acc[key]) {
            acc[key] = {
              raceData: {},
              races: [],
              ultimates: {},
            };
          }

          const parsedContent = this.handleContent(name, fileContent);

          if (['races', 'ultimates'].includes(name)) {
            acc[key][name] = parsedContent;
          } else {
            if ('id' in parsedContent) {
              acc[key].raceData[parsedContent.id] =
                parsedContent as unknown as RaceMapping;
            }
          }

          return acc;
        },
        Promise.resolve({} as Record<string, WikiDataMapping>),
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
            (value as any[]).map(({ id }) => id),
          ]),
        );
      default:
        return {
          id: data.id,
          key: data.key,
          auras: data.auras.map(({ id }) => id),
          t1spell: data.t1spell.id,
          t2spell: data.t2spell.id,
          magic: data.magic.map(({ id }) => id),
          baseUpgrades: {
            melee: data.baseUpgrades.melee.id,
            armor: data.baseUpgrades.armor.id,
            range: data.baseUpgrades.range.id,
            wall: data.baseUpgrades.wall.id,
          },
          bonuses: data.bonuses.map(({ id }) => id),
          towerUpgrades: data.towerUpgrades.map(({ id }) => id),
          units: {
            melee: data.units.melee.id,
            range: data.units.range.id,
            mage: data.units.mage.id,
            siege: data.units.siege.id,
            air: data.units.air.id,
            catapult: data.units.catapult.id,
          },
          heroes: data.heroes.map(({ id }) => id),
          bonusPicker: data.bonusPickerId,
          buildings: {
            tower: data.buildings.tower.id,
            fort: data.buildings.fort.map(({ id }) => id).slice(-3),
            barrack: data.buildings.barrack.map(({ id }) => id),
          },
          bonusByItemId: Object.fromEntries(
            data.bonuses.flatMap((bonus) => {
              const items = [
                ...(bonus.units ?? []),
                ...(bonus.heroes ?? []),
                ...(bonus.upgrades ?? []),
                ...(bonus.spells ?? []),
              ].map(({ id }) => id);
              return items.map((id) => [id, bonus.id]);
            }),
          ),
        } satisfies RaceMapping;
    }
  }

  get data() {
    return this._data;
  }
}
