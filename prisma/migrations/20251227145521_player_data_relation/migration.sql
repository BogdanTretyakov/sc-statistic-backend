/*
  Warnings:

  - You are about to drop the column `auraId` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `bonusId` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `ultimateId` on the `Player` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."PlayerDataType" AS ENUM ('BONUS', 'AURA', 'ULTIMATE');

-- DropIndex
DROP INDEX "public"."idx_match_race_bonus";

-- CreateTable
CREATE TABLE "public"."PlayerData" (
    "playerId" BIGINT NOT NULL,
    "type" "public"."PlayerDataType" NOT NULL,
    "value" VARCHAR(4) NOT NULL,
    CONSTRAINT "PlayerData_pkey" PRIMARY KEY ("playerId", "type", "value")
);

-- CreateIndex
CREATE INDEX "idx_match_race" ON "public"."Player"("matchId", "raceId");

-- AddForeignKey
ALTER TABLE "public"."PlayerData" ADD CONSTRAINT "PlayerData_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "PlayerData" ("playerId", "type", "value")
SELECT id, 'BONUS', "bonusId"
FROM "Player"
WHERE "bonusId" IS NOT NULL
ON CONFLICT DO NOTHING;


INSERT INTO "PlayerData" ("playerId", "type", "value")
SELECT id, 'AURA', "auraId"
FROM "Player"
WHERE "auraId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "PlayerData" ("playerId", "type", "value")
SELECT id, 'ULTIMATE', "ultimateId"
FROM "Player"
WHERE "ultimateId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- AlterTable
ALTER TABLE "public"."Player" DROP COLUMN "auraId",
DROP COLUMN "bonusId",
DROP COLUMN "ultimateId";
