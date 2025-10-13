#!/bin/bash
set -e

SERVICE_NAME="postgres"
DB_NAME="sc_stats"
DB_USER="root"
DB_PASS="root"
BACKUP_DIR="./backups"
DATE=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_backup_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"
echo "📦 Создаю бэкап базы '$DB_NAME' через docker-compose..."

CONTAINER_ID=$(docker compose ps -q "$SERVICE_NAME")

if [ -z "$CONTAINER_ID" ]; then
    echo "❌ Контейнер сервиса '$SERVICE_NAME' не найден! Скрипт завершен."
    exit 1
fi

echo "✅ Найден контейнер: $CONTAINER_ID"

docker exec -e PGPASSWORD="$DB_PASS" "$CONTAINER_ID" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✅ Бэкап успешно создан: $BACKUP_FILE ($SIZE)"
else
    echo "❌ Ошибка при создании бэкапа!"
    exit 1
fi
