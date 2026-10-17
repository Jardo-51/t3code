import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as EventSink from "../EventSink.ts";
import * as EventStore from "../EventStore.ts";
import * as ProjectionMaintenance from "../ProjectionMaintenance.ts";
import * as ProjectionStore from "../ProjectionStore.ts";
import * as LegacyV1ThreadImporter from "./LegacyV1ThreadImporter.ts";

const layerDatabase = SqlitePersistence.layerMemory;
const layerStores = Layer.mergeAll(
  layerDatabase,
  EventStore.layer.pipe(Layer.provideMerge(layerDatabase)),
  ProjectionStore.layer.pipe(Layer.provideMerge(layerDatabase)),
);
const layerEventSink = EventSink.layer.pipe(Layer.provide(layerStores));
const layerTest = Layer.mergeAll(
  layerStores,
  layerEventSink,
  LegacyV1ThreadImporter.layer.pipe(Layer.provide(Layer.mergeAll(layerStores, layerEventSink))),
  ProjectionMaintenance.layer.pipe(Layer.provide(layerStores)),
);

const seedLegacyThread = (threadId: ThreadId, createdAt: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT OR IGNORE INTO projection_projects (
        project_id, title, workspace_root, default_model_selection_json, scripts_json,
        created_at, updated_at, deleted_at
      ) VALUES (
        'project:tickets', 'Tickets', '/tmp/tickets', NULL, '[]',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
      )
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, latest_turn_id, created_at, updated_at, archived_at,
        settled_override, settled_at, deleted_at
      ) VALUES (
        ${threadId}, 'project:tickets', 'Ticket work', '{"instanceId":"codex","model":"gpt-5.4"}',
        'full-access', 'default', NULL, NULL, NULL, ${createdAt}, ${createdAt}, NULL,
        NULL, NULL, NULL
      )
    `;
  });

const seedLegacyTicket = (threadId: ThreadId, url: string, key: string, linkedAt: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO j_projection_thread_tickets (thread_id, url, key, source, linked_at)
      VALUES (${threadId}, ${url}, ${key}, 'agent', ${linkedAt})
    `;
    yield* sql`
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
        command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
      ) SELECT
        ${`event:${threadId}:${key}`}, 'thread', ${threadId},
        COALESCE(MAX(stream_version) + 1, 0), 'thread.j-ticket-linked',
        ${linkedAt}, NULL, NULL, NULL, 'server', '{}', '{}'
      FROM orchestration_events WHERE aggregate_kind = 'thread' AND stream_id = ${threadId}
    `;
  });

const ticketImportEventCount = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count FROM orchestration_events WHERE event_id LIKE '%:j-tickets:%'
  `;
  return rows[0]?.count ?? 0;
});

it.layer(layerTest)("JLegacyThreadTickets", (it) => {
  it.effect("carries V1 ticket links onto imported threads once", () =>
    Effect.gen(function* () {
      const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const withTickets = ThreadId.make("thread:tickets:linked");
      const withoutTickets = ThreadId.make("thread:tickets:none");
      yield* seedLegacyThread(withTickets, "2026-01-02T00:00:00.000Z");
      yield* seedLegacyThread(withoutTickets, "2026-01-03T00:00:00.000Z");
      yield* seedLegacyTicket(
        withTickets,
        "https://linear.app/acme/issue/ENG-2",
        "ENG-2",
        "2026-01-05T00:00:00.000Z",
      );
      yield* seedLegacyTicket(
        withTickets,
        "https://acme.atlassian.net/browse/PROJ-1",
        "PROJ-1",
        "2026-01-04T00:00:00.000Z",
      );
      // A link whose thread V1 no longer has has nothing to land on.
      yield* seedLegacyTicket(
        ThreadId.make("thread:tickets:orphan"),
        "https://acme.atlassian.net/browse/PROJ-9",
        "PROJ-9",
        "2026-01-04T00:00:00.000Z",
      );

      yield* importer.reconcileShells;

      const linked = yield* projections.getThreadShell(withTickets);
      assert.deepStrictEqual(linked?.jTickets, [
        {
          url: "https://acme.atlassian.net/browse/PROJ-1",
          key: "PROJ-1",
          source: "agent",
          linkedAt: "2026-01-04T00:00:00.000Z",
        },
        {
          url: "https://linear.app/acme/issue/ENG-2",
          key: "ENG-2",
          source: "agent",
          linkedAt: "2026-01-05T00:00:00.000Z",
        },
      ]);
      assert.strictEqual(
        linked && DateTime.formatIso(linked.updatedAt),
        "2026-01-02T00:00:00.000Z",
      );
      assert.isUndefined((yield* projections.getThreadShell(withoutTickets))?.jTickets);

      // The next startup finds the payload already carrying `jTickets`.
      yield* importer.reconcileShells;
      assert.strictEqual(yield* ticketImportEventCount, 1);
    }),
  );

  it.effect("repairs threads V2 imported before tickets were carried over", () =>
    Effect.gen(function* () {
      const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:tickets:repair");
      yield* seedLegacyThread(threadId, "2026-02-01T00:00:00.000Z");
      yield* importer.reconcileShells;
      assert.isUndefined((yield* projections.getThreadShell(threadId))?.jTickets);

      yield* seedLegacyTicket(
        threadId,
        "https://github.com/acme/app/issues/7",
        "app#7",
        "2026-02-02T00:00:00.000Z",
      );
      yield* importer.reconcileShells;

      assert.deepStrictEqual(
        (yield* projections.getThreadShell(threadId))?.jTickets?.map((ticket) => ticket.key),
        ["app#7"],
      );
    }),
  );

  it.effect("compaction retires the V1 ticket events with the thread's other V1 events", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const threadId = ThreadId.make("thread:tickets:compaction");
      yield* seedLegacyThread(threadId, "2026-03-01T00:00:00.000Z");
      yield* seedLegacyTicket(
        threadId,
        "https://acme.atlassian.net/browse/PROJ-3",
        "PROJ-3",
        "2026-03-02T00:00:00.000Z",
      );
      yield* importer.reconcileShells;
      yield* importer.ensureTranscript(threadId);
      yield* maintenance.compactEventStore;

      const remaining = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM orchestration_events
        WHERE stream_id = ${threadId} AND event_type LIKE 'thread.j-%'
      `;
      assert.strictEqual(remaining[0]?.count, 0);
    }),
  );
});
