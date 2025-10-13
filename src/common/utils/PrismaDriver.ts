import type { DatabaseConnection, Driver } from 'kysely';
import { PrismaConnection } from './PrismaConnection';
import type { PrismaClient } from '@prisma/client';

export class PrismaDriver<T extends PrismaClient> implements Driver {
  constructor(private readonly prisma: T) {}

  async init(): Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async acquireConnection(): Promise<DatabaseConnection> {
    return new PrismaConnection(this.prisma);
  }

  beginTransaction(): Promise<void> {
    throw new Error('does not support transactions');
  }

  commitTransaction(): Promise<void> {
    throw new Error('does not support transactions');
  }

  rollbackTransaction(): Promise<void> {
    throw new Error('does not support transactions');
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}
