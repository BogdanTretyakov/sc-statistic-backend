-- DropForeignKey
ALTER TABLE "public"."Player" DROP CONSTRAINT "Player_matchId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PlayerData" DROP CONSTRAINT "PlayerData_playerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PlayerEvent" DROP CONSTRAINT "PlayerEvent_playerMatchId_fkey";

-- AddForeignKey
ALTER TABLE "public"."Player" ADD CONSTRAINT "Player_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "public"."Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlayerData" ADD CONSTRAINT "PlayerData_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlayerEvent" ADD CONSTRAINT "PlayerEvent_playerMatchId_fkey" FOREIGN KEY ("playerMatchId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
