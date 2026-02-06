import type { MigrationContext } from '../types';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { sql } from 'kysely';

export function exec({ kysely, logger }: MigrationContext) {
  // IIFE for cancel awaiting
  void (async () => {
    logger.log('Fix bad places...');

    let lastId = 0n;
    for (;;) {
      const query = kysely
        .selectFrom('Match')
        .innerJoin('MapProcess', 'MapProcess.id', 'Match.mapProcessId')
        .leftJoin(
          'W3ChampionsMatch',
          'W3ChampionsMatch.mapProcessId',
          'MapProcess.id',
        )
        // @ts-expect-error - there is bigint
        .where('Match.id', '>', lastId)
        .where('W3ChampionsMatch.players', 'is not', null)
        .where('W3ChampionsMatch.season', '=', '22')
        .select((s) => [
          s.ref('Match.id').$castTo<bigint>().as('id'),
          s.ref('Match.mapProcessId').as('mapProcessId'),
          s
            .ref('W3ChampionsMatch.players')
            .$castTo<PrismaJson.W3ChampionsMatchPlayer[]>()
            .as('w3players'),
          jsonArrayFrom(
            s
              .selectFrom('Player as p')
              .whereRef('p.matchId', '=', 'Match.id')
              .innerJoin('PlatformPlayer as pp', 'pp.id', 'p.platformPlayerId')
              .selectAll('p')
              .select('pp.name as name'),
          ).as('players'),
        ])
        .limit(20)
        .orderBy('Match.id', 'asc');

      const data = await query.execute();
      if (!data.length) break;
      lastId = data[data.length - 1].id!;

      const update =
        Array<Omit<(typeof data)[number]['players'][number], 'name'>>();

      for (const match of data) {
        const w3players = match.w3players;
        const players = match.players;
        if (w3players.some((p) => !p.place)) continue;
        if (w3players.some((p) => !players.find((s) => s.name === p.name))) {
          continue;
        }

        const localUpdate = Array<(typeof update)[number]>();

        for (const player of players) {
          const { name, place: _, ...restPlayer } = player;
          const w3player = w3players.find((p) => p.name === name);
          if (!w3player || !w3player.place) continue;

          localUpdate.push({
            ...restPlayer,
            place: w3player.place,
          });
        }

        if (localUpdate.length === players.length) {
          update.push(...localUpdate);
          continue;
        }

        // Broken match, remove it
        logger.log(`Removing broken match ${match.id}`);
        // @ts-expect-error kysely typing
        await kysely.deleteFrom('Match').where('id', '=', match.id).execute();
      }

      if (update.length) {
        try {
          await kysely
            .updateTable('Player')
            .set({
              place: sql`place + 100`,
            })
            .where(
              'id',
              'in',
              update.map((i) => i.id),
            )
            .execute();

          await kysely
            .insertInto('Player')
            .values(update)
            .onConflict((oc) =>
              oc.column('id').doUpdateSet((us) => ({
                place: us.ref('excluded.place'),
              })),
            )
            .execute();

          logger.debug(`Updated ${update.length} players`);
        } catch (e) {
          await kysely
            .deleteFrom('Match')
            .where(
              'id',
              'in',
              // @ts-expect-error kysely typings
              data.map(({ id }) => id),
            )
            .execute();

          logger.error('Failed to update players, removing matches');
        }
      }
    }
  })();
}
