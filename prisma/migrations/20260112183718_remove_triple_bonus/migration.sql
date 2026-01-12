DELETE FROM "PlayerData" pd USING (
  SELECT
    "playerId"
  FROM
    "PlayerData"
  WHERE
    "type" = 'BONUS'
  GROUP BY
    "playerId"
  HAVING
    COUNT(*) > 2
) t
WHERE
  pd."playerId" = t."playerId"
  AND pd."value" = 'nef0';