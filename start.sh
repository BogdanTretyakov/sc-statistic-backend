#!/bin/sh
# wait-for-postgres.sh

yarn prisma generate

until yarn prisma db pull > /dev/null 2>&1; do
  echo "Waiting for postgres..."
  sleep 2
done

yarn prisma migrate deploy

exec yarn start:prod
