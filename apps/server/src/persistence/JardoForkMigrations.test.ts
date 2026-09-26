import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runJardoForkMigrations, type JardoForkMigrationEntry } from "./JardoForkMigrations.ts";
import { runMigrations } from "./Migrations.ts";
import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";

const createProbeTable = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE ${sql(table)} (id INTEGER PRIMARY KEY)`;
  });

const firstForkMigration: JardoForkMigrationEntry = [
  1,
  "ProbeOne",
  createProbeTable("j_probe_one"),
];
const secondForkMigration: JardoForkMigrationEntry = [
  2,
  "ProbeTwo",
  createProbeTable("j_probe_two"),
];

const recordedIds = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly migration_id: number }>`
      SELECT migration_id FROM ${sql(table)} ORDER BY migration_id
    `.withoutTransform;
    return rows.map((row) => row.migration_id);
  });

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("JardoForkMigrations", (it) => {
  it.effect("keeps its own high-water mark apart from upstream's", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 53 });

      // Fork ID 1 runs even though upstream already recorded 53.
      const firstRun = yield* runJardoForkMigrations({ entries: [firstForkMigration] });
      assert.deepEqual(firstRun, [[1, "ProbeOne"]]);

      // A recorded fork migration does not hide upstream's pending ones.
      const upstreamRun = yield* runMigrations({ toMigrationInclusive: 54 });
      assert.deepEqual(
        upstreamRun.map(([id]) => id),
        [54],
      );

      // A new fork migration still runs after upstream moved ahead.
      const secondRun = yield* runJardoForkMigrations({
        entries: [firstForkMigration, secondForkMigration],
      });
      assert.deepEqual(secondRun, [[2, "ProbeTwo"]]);

      assert.deepEqual(yield* recordedIds("j_sql_migrations"), [1, 2]);
      assert.equal((yield* recordedIds("effect_sql_migrations")).at(-1), 54);
    }),
  );
});

it.layer(SqlitePersistenceMemory)("SqlitePersistence startup", (it) => {
  it.effect("creates a tracking table for each migration track", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('effect_sql_migrations', 'j_sql_migrations')
        ORDER BY name
      `;
      assert.deepEqual(
        tables.map((table) => table.name),
        ["effect_sql_migrations", "j_sql_migrations"],
      );
    }),
  );
});
