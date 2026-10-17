import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { applyJThreadTicketCommand, type JThreadTicketCommand } from "./JThreadTickets.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const threadId = ThreadId.make("thread:tickets");
const createdAt = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");
const now = DateTime.makeUnsafe("2026-10-02T00:00:00.000Z");
const later = DateTime.makeUnsafe("2026-10-03T00:00:00.000Z");
const url = "https://acme.atlassian.net/browse/PROJ-1";

const thread: OrchestrationV2AppThread = {
  id: threadId,
  createdBy: "user",
  creationSource: "web",
  projectId: ProjectId.make("project:tickets"),
  title: "Tickets",
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt,
  updatedAt: createdAt,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};

const link = (key: string, source: "agent" | "manual", target = url): JThreadTicketCommand => ({
  type: "thread.j-ticket.link",
  commandId: CommandId.make(`link:${key}`),
  threadId,
  url: target,
  key,
  source,
});

describe("applyJThreadTicketCommand", () => {
  it("links a ticket once and keeps its first link time", () => {
    const linked = applyJThreadTicketCommand(thread, link("PROJ-1", "agent"), now);
    assert.deepStrictEqual(linked.jTickets, [
      { url, key: "PROJ-1", source: "agent", linkedAt: "2026-10-02T00:00:00.000Z" },
    ]);
    assert.strictEqual(linked.updatedAt, now);
    assert.strictEqual(applyJThreadTicketCommand(linked, link("PROJ-1", "manual"), later), linked);
  });

  it("lets the user correct the shown ID but not an agent override the user's", () => {
    const agent = applyJThreadTicketCommand(thread, link("PROJ-1", "agent"), now);
    const corrected = applyJThreadTicketCommand(agent, link("Payments 1", "manual"), later);
    assert.deepStrictEqual(corrected.jTickets, [
      { url, key: "Payments 1", source: "manual", linkedAt: "2026-10-02T00:00:00.000Z" },
    ]);
    assert.strictEqual(
      applyJThreadTicketCommand(corrected, link("PROJ-1", "agent"), later),
      corrected,
    );
  });

  it("unlinks only the matching ticket", () => {
    const other = "https://linear.app/acme/issue/ENG-2";
    const linked = applyJThreadTicketCommand(
      applyJThreadTicketCommand(thread, link("PROJ-1", "agent"), now),
      link("ENG-2", "agent", other),
      now,
    );
    const unlink: JThreadTicketCommand = {
      type: "thread.j-ticket.unlink",
      commandId: CommandId.make("unlink"),
      threadId,
      url,
    };
    const unlinked = applyJThreadTicketCommand(linked, unlink, later);
    assert.deepStrictEqual(
      unlinked.jTickets?.map((ticket) => ticket.url),
      [other],
    );
    assert.strictEqual(applyJThreadTicketCommand(unlinked, unlink, later), unlinked);
  });

  it("matches another URL form of a linked ticket", () => {
    const linked = applyJThreadTicketCommand(thread, link("PROJ-1", "manual"), now);
    const otherForm = `${url}?focusedCommentId=10#comment-10`;
    assert.strictEqual(
      applyJThreadTicketCommand(linked, link("PROJ-1", "agent", otherForm), later),
      linked,
    );
    const unlinked = applyJThreadTicketCommand(
      linked,
      {
        type: "thread.j-ticket.unlink",
        commandId: CommandId.make("unlink"),
        threadId,
        url: otherForm,
      },
      later,
    );
    assert.deepStrictEqual(unlinked.jTickets, []);
  });
});

// Pins the upstream hook lines (orchestrator dispatch and both shell builders) a sync could drop.
describe("ticket commands through the orchestrator", () => {
  const instanceId = ProviderInstanceId.make("codex");
  const adapter = {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
    openSession: () => Effect.die("Ticket commands never start a provider"),
  } as ProviderAdapter.ProviderAdapterV2["Service"];
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerTest = Layer.mergeAll(
    layerDatabase,
    ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
    ProviderReplayHarness.layerWithRegistry(
      { name: "j-thread-tickets" },
      ProviderAdapterRegistry.layerFromAdapters([adapter]),
      { databaseLayer: layerDatabase, runEffectWorker: false },
    ),
  );

  it.effect("links and unlinks a ticket on the thread payload and shells", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("create"),
        threadId,
        projectId: ProjectId.make("project:tickets"),
        title: "Tickets",
        modelSelection: { instanceId, model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      const shellTickets = Effect.gen(function* () {
        const persisted = yield* projections.getThreadShell(threadId);
        const replayed = ProjectionStore.threadShellFromProjection(
          yield* projections.getThreadProjection(threadId),
        );
        assert.deepStrictEqual(persisted?.jTickets, replayed.jTickets);
        return replayed.jTickets ?? [];
      });

      const linked = yield* orchestrator.dispatch(link("PROJ-1", "agent"));
      assert.deepStrictEqual(
        linked.storedEvents.map(({ event }) =>
          event.type === "thread.metadata-updated" ? event.payload.jTickets?.map((t) => t.key) : [],
        ),
        [["PROJ-1"]],
      );
      assert.deepStrictEqual(
        (yield* shellTickets).map((ticket) => ticket.url),
        [url],
      );

      yield* orchestrator.dispatch({
        type: "thread.j-ticket.unlink",
        commandId: CommandId.make("unlink"),
        threadId,
        url,
      });
      assert.deepStrictEqual(yield* shellTickets, []);
    }).pipe(Effect.provide(layerTest)),
  );
});
