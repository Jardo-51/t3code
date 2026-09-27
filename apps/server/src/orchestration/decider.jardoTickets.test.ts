import {
  CommandId,
  OrchestrationEvent,
  type OrchestrationReadModel,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ThreadTicketLink,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const encodeEvent = Schema.encodeEffect(OrchestrationEvent);
const decodeEvent = Schema.decodeEffect(OrchestrationEvent);

const NOW = "2026-01-01T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");
const URL = "https://acme.atlassian.net/browse/PROJ-1";

function makeReadModel(tickets?: ReadonlyArray<ThreadTicketLink>): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [
      {
        id: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/repo",
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        pullRequests: [],
        ...(tickets === undefined ? {} : { tickets }),
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

/** Decide, round-trip the events through the persisted encoding, and project them. */
const decideAndProject = (
  readModel: OrchestrationReadModel,
  command: Parameters<typeof decideOrchestrationCommand>[0]["command"],
) =>
  Effect.gen(function* () {
    const decided = yield* decideOrchestrationCommand({ command, readModel });
    let model = readModel;
    for (const [index, planned] of (Array.isArray(decided) ? decided : [decided]).entries()) {
      const encoded = yield* encodeEvent({ ...planned, sequence: index + 1 });
      model = yield* projectEvent(model, yield* decodeEvent(encoded));
    }
    return model.threads[0]!;
  });

it.layer(NodeServices.layer)("ticket link decider", (it) => {
  it.effect("links a ticket to a thread that had none", () =>
    Effect.gen(function* () {
      const thread = yield* decideAndProject(makeReadModel(), {
        type: "thread.j-ticket.link",
        commandId: CommandId.make("cmd-link"),
        threadId: THREAD_ID,
        url: URL,
        key: "PROJ-1",
        source: "agent",
      });
      expect(thread.tickets).toEqual([
        { url: URL, key: "PROJ-1", source: "agent", linkedAt: expect.any(String) },
      ]);
    }),
  );

  it.effect("rejects linking the same ticket twice", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.j-ticket.link",
          commandId: CommandId.make("cmd-link"),
          threadId: THREAD_ID,
          url: URL,
          key: "PROJ-1",
          source: "manual",
        },
        readModel: makeReadModel([{ url: URL, key: "PROJ-1", source: "agent", linkedAt: NOW }]),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("unlinks only the named ticket, and rejects one that is not linked", () =>
    Effect.gen(function* () {
      const other: ThreadTicketLink = {
        url: "https://linear.app/acme/issue/ENG-2",
        key: "ENG-2",
        source: "manual",
        linkedAt: NOW,
      };
      const readModel = makeReadModel([
        { url: URL, key: "PROJ-1", source: "agent", linkedAt: NOW },
        other,
      ]);
      const thread = yield* decideAndProject(readModel, {
        type: "thread.j-ticket.unlink",
        commandId: CommandId.make("cmd-unlink"),
        threadId: THREAD_ID,
        url: URL,
      });
      expect(thread.tickets).toEqual([other]);

      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.j-ticket.unlink",
          commandId: CommandId.make("cmd-unlink-again"),
          threadId: THREAD_ID,
          url: URL,
        },
        readModel: makeReadModel([other]),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
