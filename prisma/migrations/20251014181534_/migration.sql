-- CreateTable
CREATE TABLE "public"."MigrationCustom" (
    "name" TEXT NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "error" BOOLEAN,

    CONSTRAINT "MigrationCustom_pkey" PRIMARY KEY ("name")
);
