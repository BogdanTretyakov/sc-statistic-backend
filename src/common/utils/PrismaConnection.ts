import type { PrismaClient } from '@prisma/client';
import {
  DeleteQueryNode,
  InsertQueryNode,
  UpdateQueryNode,
  type CompiledQuery,
  type DatabaseConnection,
  type QueryResult,
} from 'kysely';

export class PrismaConnection implements DatabaseConnection {
  constructor(private readonly prisma: PrismaClient) {}

  async executeQuery<R>(
    compiledQuery: CompiledQuery<unknown>,
  ): Promise<QueryResult<R>> {
    const { sql, parameters, query } = compiledQuery;

    // Delete, update and insert queries return the number of affected rows if no returning clause is specified
    const supportsReturning =
      DeleteQueryNode.is(query) ||
      UpdateQueryNode.is(query) ||
      InsertQueryNode.is(query);
    const shouldReturnAffectedRows = supportsReturning && !query.returning;

    // Execute the query with $executeRawUnsafe to get the number of affected rows
    if (shouldReturnAffectedRows) {
      const numAffectedRows = BigInt(
        await this.prisma.$executeRawUnsafe(sql, ...parameters),
      );
      return {
        rows: [],
        numAffectedRows: numAffectedRows,
        numChangedRows: numAffectedRows,
      };
    }

    // Otherwise, execute it with $queryRawUnsafe to get the query results
    const rows = await this.prisma.$queryRawUnsafe<R[]>(sql, ...parameters);
    return { rows };
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('does not support streaming queries');
  }
}
