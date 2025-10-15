import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { MigrationCustom } from '@prisma/client';
import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { KyselyService } from 'src/common/kysely.service';
import { PrismaService } from 'src/common/prisma.service';
import { WikiDataService } from 'src/common/wikiData.service';
import type { MigrationContext } from './types';

@Injectable()
export class MigrationService implements OnModuleInit {
  private readonly logger = new Logger(MigrationService.name);
  private migrations = Array<MigrationCustom>();
  private migrationFiles = Array<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly kysely: KyselyService,
    private readonly wikiData: WikiDataService,
  ) {}

  private async getMigrationFiles() {
    const rawFiles = (await readdir(resolve(__dirname, 'items')))
      .sort((a, b) => a.localeCompare(b))
      .map((s) => s.replace(/\..*$/, ''));
    this.migrationFiles = Array.from(new Set(rawFiles));
  }

  private async clearMigrations() {
    await this.prisma.migrationCustom.deleteMany({
      where: { name: { notIn: this.migrationFiles } },
    });
  }

  private async execMigrations() {
    const waitingMigrations = this.migrationFiles.filter(
      (name) => !this.migrations.some((m) => m.name === name),
    );

    if (waitingMigrations.length) {
      this.logger.verbose(`Found ${waitingMigrations.length}, start exec`);
    }

    for (const migrationFile of waitingMigrations) {
      this.logger.debug(`Start to exec migration ${migrationFile}`);
      try {
        const module = await import(`./items/${migrationFile}.js`);
        if (module.exec) {
          const migrationCtx: MigrationContext = {
            logger: new Logger(`Migration:${migrationFile}`),
            kysely: this.kysely,
            prisma: this.prisma,
            wikiData: this.wikiData,
          };
          await module.exec(migrationCtx);
          await this.prisma.migrationCustom.upsert({
            where: { name: migrationFile },
            create: {
              name: migrationFile,
              finishedAt: new Date(),
            },
            update: { finishedAt: new Date() },
          });
          this.logger.log(`Migration ${migrationFile} exec successful`);
        }
      } catch (e) {
        await this.prisma.migrationCustom.upsert({
          where: { name: migrationFile },
          create: { name: migrationFile, error: true },
          update: { error: true },
        });
        this.logger.fatal(`Error while run migration ${migrationFile}`);
        throw e;
      }
    }
  }

  async onModuleInit() {
    await this.getMigrationFiles();
    await this.clearMigrations();
    this.migrations = await this.prisma.migrationCustom.findMany();
    const errorMigration = this.migrations.find((m) => m.error);
    if (errorMigration) {
      const errMsg = `There is stored migration with error: ${errorMigration.name}`;
      this.logger.fatal(errMsg);
      process.exit(1);
    }
    await this.execMigrations();
  }
}
