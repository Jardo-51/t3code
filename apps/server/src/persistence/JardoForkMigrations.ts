/**
 * Fork-only migration track, run by the SQLite persistence layer right after
 * `runMigrations`.
 *
 * Effect's Migrator records only the highest applied ID and skips anything at
 * or below it, so fork migrations cannot share upstream's list without either
 * colliding with upstream's next ID or hiding every later upstream migration.
 * This track keeps its own numbering (starting at 1) and its own tracking table
 * (`j_sql_migrations`), so neither high-water mark can hide the other's
 * migrations. See "Custom database migrations" in docs/jardo/forking-strategy.md
 * for the rules fork migrations follow.
 *
 * Add migrations as `./JardoForkMigrations/NNN_Name.ts`, statically imported and
 * listed in `migrationEntries` like `Migrations.ts` does.
 */

import * as Migrator from "effect/unstable/sql/Migrator";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

export const JARDO_FORK_MIGRATIONS_TABLE = "j_sql_migrations";

export type JardoForkMigrationEntry = readonly [
  id: number,
  name: string,
  migration: Effect.Effect<void, SqlError, SqlClient.SqlClient>,
];

const migrationEntries: ReadonlyArray<JardoForkMigrationEntry> = [];

const run = Migrator.make({});

export interface RunJardoForkMigrationsOptions {
  /** Replaces the fork's migration list; lets tests exercise the track while it is empty. */
  readonly entries?: ReadonlyArray<JardoForkMigrationEntry> | undefined;
}

/**
 * Run all pending fork migrations, recording them in `j_sql_migrations`.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 */
export const runJardoForkMigrations = Effect.fn("runJardoForkMigrations")(function* ({
  entries = migrationEntries,
}: RunJardoForkMigrationsOptions = {}) {
  const executedMigrations = yield* run({
    loader: Migrator.fromRecord(
      Object.fromEntries(entries.map(([id, name, migration]) => [`${id}_${name}`, migration])),
    ),
    table: JARDO_FORK_MIGRATIONS_TABLE,
  });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Fork database schema is current")
    : Effect.log("Fork migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  return executedMigrations;
});
