import type { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { PrismaClient } from '@prisma/client';
import type { Kysely } from 'kysely';
import type { DB } from 'src/common/types/kysely';
import type { WikiDataService } from 'src/common/wikiData.service';

export interface MigrationContext {
  logger: Logger;
  prisma: PrismaClient;
  kysely: Kysely<DB>;
  wikiData: WikiDataService;
  moduleRef: ModuleRef;
}
