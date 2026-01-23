-- CreateIndex
CREATE INDEX "idx_platform" ON "public"."MapProcess"("platform");

-- CreateIndex
CREATE INDEX "idx_season" ON "public"."W3ChampionsMatch"("season");

-- CreateIndex
CREATE INDEX "idx_mapProcessId" ON "public"."W3ChampionsMatch"("mapProcessId");
