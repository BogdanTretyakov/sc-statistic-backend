-- CreateTable
CREATE TABLE "public"."WikiData" (
    "dataKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSON NOT NULL,
    "sha" TEXT NOT NULL,

    CONSTRAINT "WikiData_pkey" PRIMARY KEY ("dataKey","key")
);
