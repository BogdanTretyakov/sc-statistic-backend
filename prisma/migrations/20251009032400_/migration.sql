-- CreateEnum
CREATE TYPE "public"."MatchPlatform" AS ENUM ('W3Champions');

-- CreateEnum
CREATE TYPE "public"."ProcessError" AS ENUM ('BAD_MAP', 'NO_MAPPING', 'PARSING_ERROR');

-- CreateEnum
CREATE TYPE "public"."PlayerEvents" AS ENUM (
    'INITIAL_RACE',
    'BAN_RACE',
    'REPICK_RACE',
    'HERO_BUY',
    'BASE_UPGRADE',
    'TOWER_UPGRADE',
    'UP_FORT2',
    'UP_FORT3',
    'UP_BARRACK2',
    'UP_BARRACK3',
    'UP_BARRACK4',
    'USE_ULTIMATE'
);

-- CreateTable
CREATE TABLE
    "public"."MapVersion" (
        "id" SERIAL NOT NULL,
        "mapName" TEXT NOT NULL,
        "mapType" VARCHAR(2),
        "mapVersion" VARCHAR(6),
        "mapPatch" VARCHAR(4),
        "dataKey" TEXT,
        "ignore" BOOLEAN NOT NULL DEFAULT false,
        CONSTRAINT "MapVersion_pkey" PRIMARY KEY ("id")
    );

-- CreateTable
CREATE TABLE
    "public"."MapProcess" (
        "id" BIGSERIAL NOT NULL,
        "mapId" INTEGER,
        "platform" "public"."MatchPlatform" NOT NULL,
        "filePath" TEXT NOT NULL,
        "mappingError" "public"."ProcessError",
        "downloadError" SMALLINT,
        "processed" BOOLEAN NOT NULL DEFAULT false,
        CONSTRAINT "MapProcess_pkey" PRIMARY KEY ("id")
    );

-- CreateTable
CREATE TABLE
    "public"."W3ChampionsMatch" (
        "id" VARCHAR(24) NOT NULL,
        "time" TIMESTAMP(3) NOT NULL,
        "season" VARCHAR(4) NOT NULL,
        "players" JSON NOT NULL,
        "mapProcessId" BIGINT,
        CONSTRAINT "W3ChampionsMatch_pkey" PRIMARY KEY ("id")
    );

-- CreateTable
CREATE TABLE
    "public"."Match" (
        "id" BIGSERIAL NOT NULL,
        "duration" INTEGER NOT NULL,
        "endAt" TIMESTAMP(3) NOT NULL,
        "avgMmr" INTEGER,
        "avgQuantile" SMALLINT,
        "hasLeavers" BOOLEAN NOT NULL,
        "mapId" INTEGER NOT NULL,
        "mapProcessId" BIGINT NOT NULL,
        CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
    );

-- CreateTable
CREATE TABLE
    "public"."Player" (
        "id" BIGSERIAL NOT NULL,
        "matchId" BIGINT NOT NULL,
        "platformPlayerId" INTEGER NOT NULL,
        "place" SMALLINT NOT NULL,
        "timeAlive" INTEGER NOT NULL,
        "raceId" VARCHAR(4) NOT NULL,
        "bonusId" VARCHAR(4),
        "auraId" VARCHAR(4),
        "ultimateId" VARCHAR(4),
        "mmr" INTEGER,
        "quantile" SMALLINT,
        CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
    );

-- CreateTable
CREATE TABLE
    "public"."PlatformPlayer" (
        "id" SERIAL NOT NULL,
        "name" TEXT NOT NULL,
        "platform" "public"."MatchPlatform" NOT NULL,
        "lastMmr" INTEGER,
        "lastSeenAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "PlatformPlayer_pkey" PRIMARY KEY ("id")
    );

-- CreateTable
CREATE TABLE
    "public"."PlayerEvent" (
        "playerMatchId" BIGINT NOT NULL,
        "eventType" "public"."PlayerEvents" NOT NULL,
        "eventId" VARCHAR(4) NOT NULL,
        "time" INTEGER NOT NULL,
        CONSTRAINT "PlayerEvent_pkey" PRIMARY KEY ("playerMatchId", "eventType", "eventId", "time")
    )
PARTITION BY
    LIST ("eventType");

CREATE TABLE
    "public"."_PlayerEvent_Upgrades" PARTITION OF "public"."PlayerEvent" FOR
VALUES
    IN ('TOWER_UPGRADE', 'BASE_UPGRADE');

CREATE TABLE
    "public"."_PlayerEvent_Buildings" PARTITION OF "public"."PlayerEvent" FOR
VALUES
    IN (
        'UP_FORT2',
        'UP_FORT3',
        'UP_BARRACK2',
        'UP_BARRACK3',
        'UP_BARRACK4'
    );

CREATE TABLE
    "public"."_PlayerEvent_Other" PARTITION OF "public"."PlayerEvent" DEFAULT;

-- CreateTable
CREATE TABLE
    "public"."DatabaseDump" (
        "id" UUID NOT NULL,
        "date" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "DatabaseDump_pkey" PRIMARY KEY ("id")
    );

-- CreateIndex
CREATE UNIQUE INDEX "MapVersion_mapName_key" ON "public"."MapVersion" ("mapName");

-- CreateIndex
CREATE UNIQUE INDEX "MapProcess_filePath_key" ON "public"."MapProcess" ("filePath");

-- CreateIndex
CREATE INDEX "idx_end_at" ON "public"."Match" ("endAt");

-- CreateIndex
CREATE INDEX "idx_map" ON "public"."Match" ("mapId");

-- CreateIndex
CREATE INDEX "idx_quantile_leavers_map_duration" ON "public"."Match" ("avgQuantile", "duration", "hasLeavers", "mapId");

-- CreateIndex
CREATE INDEX "idx_matchId_mmr" ON "public"."Player" ("matchId", "mmr");

-- CreateIndex
CREATE INDEX "idx_match_race_bonus" ON "public"."Player" ("matchId", "raceId", "bonusId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_matchId_place_key" ON "public"."Player" ("matchId", "place");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPlayer_name_platform_key" ON "public"."PlatformPlayer" ("name", "platform");

-- CreateIndex
CREATE INDEX "idx_event_type_id_player" ON "public"."PlayerEvent" ("eventType", "eventId", "playerMatchId");

-- AddForeignKey
ALTER TABLE "public"."MapProcess" ADD CONSTRAINT "MapProcess_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "public"."MapVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."W3ChampionsMatch" ADD CONSTRAINT "W3ChampionsMatch_mapProcessId_fkey" FOREIGN KEY ("mapProcessId") REFERENCES "public"."MapProcess" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Match" ADD CONSTRAINT "Match_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "public"."MapVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Match" ADD CONSTRAINT "Match_mapProcessId_fkey" FOREIGN KEY ("mapProcessId") REFERENCES "public"."MapProcess" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Player" ADD CONSTRAINT "Player_platformPlayerId_fkey" FOREIGN KEY ("platformPlayerId") REFERENCES "public"."PlatformPlayer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Player" ADD CONSTRAINT "Player_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "public"."Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlayerEvent" ADD CONSTRAINT "PlayerEvent_playerMatchId_fkey" FOREIGN KEY ("playerMatchId") REFERENCES "public"."Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;