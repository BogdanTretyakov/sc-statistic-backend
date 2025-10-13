#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DATABASE_HOST:-db}"
DB_USER="${DATABASE_USER:-root}"
DB_NAME="${DATABASE_NAME:-sc_stats}"
DB_PORT="${DATABASE_PORT:-5432}"
RETRY_WAIT="${DB_RETRY_WAIT:-4}"

echo "Waiting for Postgres at ${DB_HOST}:${DB_PORT}..."

until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"; do
  echo "Postgres is not ready. Sleeping ${RETRY_WAIT}s..."
  sleep "$RETRY_WAIT"
done

echo "Postgres is ready. Running Prisma migrations..."
yarn prisma migrate deploy --schema=./prisma/schema.prisma

echo "Starting app..."
exec yarn start:prod
