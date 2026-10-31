/**
 * Fork-only migrations with their own numbering and `j_sql_migrations` table: Effect's Migrator
 * skips every ID at or below the highest applied one, so a shared list would hide migrations.
 * Rules: "Custom database migrations" in docs/jardo/forking-strategy.md.
 */

import * as Migrator from "effect/sql/Migrator";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import Migration0001 from "./JardoForkMigrations/001_ProjectionThreadTickets.ts";

const JARDO_FORK_MIGRATIONS_TABLE = "j_sql_migrations";

export type JardoForkMigrationEntry = readonly [
  id: number,
  name: string,
  migration: Effect.Effect<void, SqlError, SqlClient.SqlClient>,
];

const migrationEntries: ReadonlyArray<JardoForkMigrationEntry> = [
  [1, "ProjectionThreadTickets", Migration0001],
];

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
