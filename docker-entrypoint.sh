#!/bin/sh
# wait-for-postgres.sh
set -euo pipefail

yarn install --frozen-lockfile

export NODE_ENV=production

yarn prisma generate
yarn build
yarn prisma migrate deploy

exec yarn start:prod
