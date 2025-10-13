DO $$
DECLARE
  step_interval INTERVAL := INTERVAL '3 day';
  t_start TIMESTAMP;
  t_end TIMESTAMP;
BEGIN
  SELECT MIN(m."endAt") + INTERVAL '7 days', MAX(m."endAt")
  INTO t_start, t_end
  FROM "Match" m
  WHERE COALESCE(m."avgQuantile", 0) = 0;

  IF t_start IS NULL OR t_end IS NULL THEN
    RAISE NOTICE 'No matches found, aborting quantile calculation.';
    RETURN;
  END IF;

  RAISE NOTICE 'Updating quantiles from % to %', t_start, t_end;

  WHILE t_start <= t_end LOOP
    RAISE NOTICE 'Processing quantiles up to: %', t_start;

    WITH latest_mmr AS (
      SELECT DISTINCT ON (p."platformPlayerId")
        p."platformPlayerId",
        p."mmr"
      FROM "Player" p
      JOIN "Match" m ON m.id = p."matchId"
      WHERE m."endAt" <= t_start
        AND p."mmr" IS NOT NULL
        AND COALESCE(p."quantile", 0) = 0
      ORDER BY p."platformPlayerId", m."endAt" DESC
    ),
    ranked AS (
      SELECT
        "platformPlayerId",
        PERCENT_RANK() OVER (ORDER BY mmr) AS percentile
      FROM latest_mmr
    )
    UPDATE "Player" AS pp
    SET "quantile" = ROUND(ranked.percentile * 100)
    FROM ranked
    WHERE pp."platformPlayerId" = ranked."platformPlayerId"
      AND COALESCE(pp."quantile", 0) = 0
      AND pp."matchId" IN (
        SELECT m.id
        FROM "Match" m
        WHERE m."endAt" <= t_start
      );

    t_start := t_start + step_interval;
  END LOOP;

  UPDATE "Match" m
  SET "avgQuantile" = ROUND(sub.avg_q)
  FROM (
      SELECT
          p."matchId",
          AVG(p."quantile") AS avg_q
      FROM "Player" p
      GROUP BY p."matchId"
  ) AS sub
  WHERE m.id = sub."matchId"
    AND COALESCE(m."avgQuantile", 0) = 0;

  RAISE NOTICE 'Quantile update finished successfully.';
END $$;