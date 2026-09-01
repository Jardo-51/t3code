import {
  CommandId,
  DraftId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationDraft,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const EARLIER = "2025-12-31T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const DRAFT_ID = DraftId.make("draft-1");

const draftContent = {
  projectId: PROJECT_ID,
  threadId: THREAD_ID,
  prompt: "ship the thing",
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  envMode: "local",
  startFromOrigin: false,
  modelSelectionByProvider: {},
  activeProvider: null,
  modelSelectionExplicit: false,
  deviceOnlyAttachmentCount: 0,
} satisfies Omit<OrchestrationDraft, "id" | "createdAt" | "updatedAt">;

function makeDraft(overrides: Partial<OrchestrationDraft> = {}): OrchestrationDraft {
  return {
    id: DRAFT_ID,
    ...draftContent,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...overrides,
  };
}

function makeReadModel(input: {
  readonly drafts?: ReadonlyArray<OrchestrationDraft>;
  readonly withProject?: boolean;
  readonly withThread?: boolean;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    drafts: input.drafts ?? [],
    projects:
      input.withProject === false
        ? []
        : [
            {
              id: PROJECT_ID,
              title: "Project",
              workspaceRoot: "/tmp/project-1",
              defaultModelSelection: null,
              scripts: [],
              createdAt: NOW,
              updatedAt: NOW,
              deletedAt: null,
            },
          ],
    threads: input.withThread
      ? [
          {
            id: THREAD_ID,
            projectId: PROJECT_ID,
            title: "Thread",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            latestTurn: null,
            createdAt: NOW,
            updatedAt: NOW,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            snoozedUntil: null,
            snoozedAt: null,
            deletedAt: null,
            messages: [],
            proposedPlans: [],
            activities: [],
            checkpoints: [],
            session: null,
          },
        ]
      : [],
    updatedAt: NOW,
  };
}

const upsertCommand = {
  type: "draft.upsert",
  commandId: CommandId.make("cmd-upsert"),
  draftId: DRAFT_ID,
  ...draftContent,
  createdAt: NOW,
} as const;

it.layer(NodeServices.layer)("draft decider", (it) => {
  it.effect("stamps the edit time as updatedAt and keeps the original createdAt", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: upsertCommand,
        readModel: makeReadModel({ drafts: [makeDraft()] }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("draft.upserted");
      if (events[0]?.type === "draft.upserted") {
        expect(events[0].aggregateKind).toBe("draft");
        expect(events[0].aggregateId).toBe(DRAFT_ID);
        expect(events[0].payload.draft.createdAt).toBe(EARLIER);
        expect(events[0].payload.draft.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("uses the edit time as createdAt for a draft the server has not seen", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: upsertCommand,
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(event) ? event : [event];
      if (events[0]?.type === "draft.upserted") {
        expect(events[0].payload.draft.createdAt).toBe(NOW);
      }
    }),
  );

  it.effect("rejects a draft for a project that does not exist", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          command: upsertCommand,
          readModel: makeReadModel({ withProject: false }),
        }),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("rejects a draft whose thread was already created by another client", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          command: upsertCommand,
          readModel: makeReadModel({ withThread: true }),
        }),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("discards a draft it has never seen rather than failing the client", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "draft.discard",
          commandId: CommandId.make("cmd-discard"),
          draftId: DRAFT_ID,
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("draft.discarded");
    }),
  );

  it.effect("retires the draft holding a thread's id when that thread is created", () =>
    Effect.gen(function* () {
      const events = yield* decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.make("cmd-create"),
          threadId: THREAD_ID,
          projectId: PROJECT_ID,
          title: "Thread",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: NOW,
        },
        readModel: makeReadModel({ drafts: [makeDraft()] }),
      }).pipe(Effect.map((event) => (Array.isArray(event) ? event : [event])));

      expect(events.map((event) => event.type)).toEqual(["thread.created", "draft.discarded"]);
      const discarded = events[1];
      if (discarded?.type === "draft.discarded") {
        expect(discarded.payload.draftId).toBe(DRAFT_ID);
      }
    }),
  );

  it.effect("creates a thread with no draft behind it as a single event", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.make("cmd-create-2"),
          threadId: THREAD_ID,
          projectId: PROJECT_ID,
          title: "Thread",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      });
      expect(Array.isArray(event)).toBe(false);
    }),
  );
});
