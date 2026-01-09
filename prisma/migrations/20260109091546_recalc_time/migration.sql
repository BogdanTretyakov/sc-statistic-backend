CREATE TEMP TABLE "match_offset" ON COMMIT
DROP AS
WITH
  median_offset AS (
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY
          min_time
      ) AS median_time
    FROM
      (
        SELECT
          p."matchId",
          MIN(pe."time") AS min_time
        FROM
          "PlayerEvent" pe
          JOIN "Player" p ON p."id" = pe."playerMatchId"
        WHERE
          pe."eventType" IN ('REPICK_RACE', 'BASE_UPGRADE', 'UP_BARRACK2')
        GROUP BY
          p."matchId"
      ) t
  )
SELECT
  p."matchId",
  LEAST (
    MIN(pe."time"),
    (
      SELECT
        median_time
      FROM
        median_offset
    )
  ) AS "offset"
FROM
  "PlayerEvent" pe
  JOIN "Player" p ON p."id" = pe."playerMatchId"
WHERE
  pe."eventType" IN ('REPICK_RACE', 'BASE_UPGRADE', 'UP_BARRACK2')
GROUP BY
  p."matchId";

WITH
  new_times AS (
    SELECT DISTINCT
      ON (pe."playerMatchId", pe."eventType", pe."eventId") pe."playerMatchId",
      pe."eventType",
      pe."eventId",
      pe."time" AS old_time,
      GREATEST (pe."time" - mo."offset", 0) AS new_time
    FROM
      "PlayerEvent" pe
      JOIN "Player" p ON p."id" = pe."playerMatchId"
      JOIN "match_offset" mo ON p."matchId" = mo."matchId"
  )
UPDATE "PlayerEvent" pe
SET
  "time" = nt.new_time
FROM
  new_times nt
WHERE
  pe."playerMatchId" = nt."playerMatchId"
  AND pe."eventType" = nt."eventType"
  AND pe."eventId" = nt."eventId"
  AND pe."time" = nt.old_time;

UPDATE "Player" p
SET
  "timeAlive" = GREATEST (p."timeAlive" - mo."offset", 0)
FROM
  "match_offset" mo
WHERE
  p."matchId" = mo."matchId";

UPDATE "Match" m
SET
  "duration" = GREATEST (m."duration" - mo."offset", 0)
FROM
  "match_offset" mo
WHERE
  m."id" = mo."matchId";