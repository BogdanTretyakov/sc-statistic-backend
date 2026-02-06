-- AlterTable
ALTER TABLE "public"."Match"
ADD COLUMN "platform" "public"."MatchPlatform",
ADD COLUMN "season" TEXT;

-- At the moment of this migration, all matches are W3Champions
UPDATE "public"."Match"
SET
  "platform" = 'W3Champions';

UPDATE "public"."Match"
SET
  "season" = '22'
WHERE
  "public"."Match"."endAt" <= '2025-10-06T10:00:00.156Z';

UPDATE "public"."Match"
SET
  "season" = '23'
WHERE
  "public"."Match"."endAt" > '2025-10-06T10:00:00.156Z'
  AND "public"."Match"."endAt" <= '2026-01-26T10:54:00.156Z';

UPDATE "public"."Match"
SET
  "season" = '24'
WHERE
  "public"."Match"."season" is NULL;

ALTER TABLE "public"."Match"
ALTER COLUMN "platform"
SET
  NOT NULL,
ALTER COLUMN "season"
SET
  NOT NULL;

-- CreateIndex
CREATE INDEX "idx_platform_season" ON "public"."Match" ("platform", "season");