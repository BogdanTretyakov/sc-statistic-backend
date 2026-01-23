#!/bin/sh
# wait-for-postgres.sh
set -euo pipefail

yarn install --frozen-lockfile

export NODE_ENV=production

until yarn prisma db pull > /dev/null 2>&1; do
  echo "Waiting for postgres..."
  sleep 2
done

yarn prisma generate
yarn build
yarn prisma migrate deploy

exec yarn start:prod
