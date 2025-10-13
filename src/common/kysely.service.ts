import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import type { DB } from './types/kysely';
import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaDriver } from './utils/PrismaDriver';

@Injectable()
export class KyselyService extends Kysely<DB> {
  constructor(private prisma: PrismaService) {
    const driver = new PrismaDriver(prisma);
    super({
      dialect: {
        createDriver: () => driver,
        createAdapter: () => new PostgresAdapter(),
        createIntrospector: (db) => new PostgresIntrospector(db),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
  }
}
