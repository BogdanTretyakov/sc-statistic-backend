-- AlterEnum
ALTER TYPE "public"."PlayerEvents" ADD VALUE 'BONUS_UPGRADE';

-- Empty the WikiData table
DELETE FROM "public"."WikiData";