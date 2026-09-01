import {
  CommandId,
  DraftId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationDraft,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-1");
const DRAFT_ID = DraftId.make("draft-1");

function makeDraft(overrides: Partial<OrchestrationDraft> = {}): OrchestrationDraft {
  return {
    id: DRAFT_ID,
    projectId: PROJECT_ID,
    threadId: ThreadId.make("thread-1"),
    prompt: "first",
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly payload: unknown;
  readonly aggregateKind?: OrchestrationEvent["aggregateKind"];
  readonly aggregateId?: OrchestrationEvent["aggregateId"];
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind ?? "draft",
    aggregateId: input.aggregateId ?? DRAFT_ID,
    occurredAt: NOW,
    commandId: CommandId.make(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

it.effect("keeps the newer edit when two clients write the same draft out of order", () =>
  Effect.gen(function* () {
    const newer = yield* projectEvent(
      createEmptyReadModel(NOW),
      makeEvent({
        sequence: 1,
        type: "draft.upserted",
        payload: {
          draft: makeDraft({ prompt: "newer", updatedAt: "2026-01-01T00:00:05.000Z" }),
        },
      }),
    );
    expect(newer.drafts).toHaveLength(1);

    // Arrives second but was typed first: the projection must not roll back.
    const stale = yield* projectEvent(
      newer,
      makeEvent({
        sequence: 2,
        type: "draft.upserted",
        payload: {
          draft: makeDraft({ prompt: "older", updatedAt: "2026-01-01T00:00:03.000Z" }),
        },
      }),
    );
    expect(stale.drafts[0]?.prompt).toBe("newer");

    const later = yield* projectEvent(
      stale,
      makeEvent({
        sequence: 3,
        type: "draft.upserted",
        payload: {
          draft: makeDraft({ prompt: "latest", updatedAt: "2026-01-01T00:00:09.000Z" }),
        },
      }),
    );
    expect(later.drafts[0]?.prompt).toBe("latest");
  }),
);

it.effect("removes a discarded draft", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(
      createEmptyReadModel(NOW),
      makeEvent({ sequence: 1, type: "draft.upserted", payload: { draft: makeDraft() } }),
    );
    const discarded = yield* projectEvent(
      created,
      makeEvent({
        sequence: 2,
        type: "draft.discarded",
        payload: { draftId: DRAFT_ID, discardedAt: NOW },
      }),
    );
    expect(discarded.drafts).toHaveLength(0);
  }),
);

it.effect("drops a project's drafts when the project is deleted", () =>
  Effect.gen(function* () {
    const withProject = yield* projectEvent(
      createEmptyReadModel(NOW),
      makeEvent({
        sequence: 1,
        type: "project.created",
        aggregateKind: "project",
        aggregateId: PROJECT_ID,
        payload: {
          projectId: PROJECT_ID,
          title: "Project",
          workspaceRoot: "/tmp/project-1",
          defaultModelSelection: null,
          scripts: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    const withDraft = yield* projectEvent(
      withProject,
      makeEvent({ sequence: 2, type: "draft.upserted", payload: { draft: makeDraft() } }),
    );
    expect(withDraft.drafts).toHaveLength(1);

    const deleted = yield* projectEvent(
      withDraft,
      makeEvent({
        sequence: 3,
        type: "project.deleted",
        aggregateKind: "project",
        aggregateId: PROJECT_ID,
        payload: { projectId: PROJECT_ID, deletedAt: NOW },
      }),
    );
    expect(deleted.drafts).toHaveLength(0);
  }),
);
