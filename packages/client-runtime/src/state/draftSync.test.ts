import { describe, expect, it } from "vite-plus/test";
import {
  DraftId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type OrchestrationDraft,
} from "@t3tools/contracts";

import { planDraftSync, type LocalDraftRecord, type SyncedDraftRecord } from "./draftSync.ts";

const ENVIRONMENT_ID = EnvironmentId.make("env-1");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("env-2");
const DRAFT_ID = DraftId.make("draft-1");

function makeRemote(overrides: Partial<OrchestrationDraft> = {}): OrchestrationDraft {
  return {
    id: DRAFT_ID,
    projectId: ProjectId.make("project-1"),
    threadId: ThreadId.make("thread-1"),
    prompt: "remote text",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:10.000Z",
    ...overrides,
  };
}

function makeLocal(overrides: Partial<LocalDraftRecord> = {}): LocalDraftRecord {
  return {
    draftId: DRAFT_ID,
    environmentId: ENVIRONMENT_ID,
    signature: "sig-local",
    hasContent: true,
    ...overrides,
  };
}

function synced(record: Partial<SyncedDraftRecord> = {}) {
  return new Map<DraftId, SyncedDraftRecord>([
    [DRAFT_ID, { signature: "sig-local", updatedAt: "2026-01-01T00:00:05.000Z", ...record }],
  ]);
}

describe("planDraftSync", () => {
  it("pushes a draft the server has never seen", () => {
    const plan = planDraftSync({
      environmentId: ENVIRONMENT_ID,
      localDrafts: [makeLocal()],
      remoteDrafts: [],
      syncedDrafts: new Map(),
      editingDraftId: null,
    });
    expect(plan.push).toEqual([DRAFT_ID]);
    expect(plan.removeLocal).toEqual([]);
  });

  it("pushes a draft edited since the last successful push", () => {
    const plan = planDraftSync({
      environmentId: ENVIRONMENT_ID,
      localDrafts: [makeLocal({ signature: "sig-newer" })],
      remoteDrafts: [makeRemote()],
      syncedDrafts: synced(),
      editingDraftId: null,
    });
    expect(plan.push).toEqual([DRAFT_ID]);
    expect(plan.applyRemote).toEqual([]);
  });

  it("leaves an unchanged draft alone", () => {
    const plan = planDraftSync({
      environmentId: ENVIRONMENT_ID,
      localDrafts: [makeLocal()],
      remoteDrafts: [makeRemote({ updatedAt: "2026-01-01T00:00:05.000Z" })],
      syncedDrafts: synced(),
      editingDraftId: null,
    });
    expect(plan).toEqual({ push: [], discard: [], applyRemote: [], removeLocal: [] });
  });

  it("takes a newer copy edited on another device", () => {
    const remote = makeRemote({ updatedAt: "2026-01-01T00:00:20.000Z" });
    const plan = planDraftSync({
      environmentId: ENVIRONMENT_ID,
      localDrafts: [makeLocal()],
      remoteDrafts: [remote],
      syncedDrafts: synced(),
      editingDraftId: null,
    });
    expect(plan.applyRemote).toEqual([remote]);
  });

  it("never overwrites the composer the user is typing into", () => {
    const plan = planDraftSync({
      environmentId: ENVIRONMENT_ID,
      localDrafts: [makeLocal()],
      remoteDrafts: [makeRemote({ updatedAt: "2026-01-01T00:00:20.000Z" })],
      syncedDrafts: synced(),
      editingDraftId: DRAFT_ID,
    });
    expect(plan.applyRemote).toEqual([]);
  });

  it("adopts a draft started on another device", () => {
    const remote = makeRemote({ id: DraftId.make("draft-2") });
    const plan = planDraftSync({
      environmentId: ENVIRONMENT_ID,
      localDrafts: [],
      remoteDrafts: [remote],
      syncedDrafts: new Map(),
      editingDraftId: null,
    });
    expect(plan.applyRemote).toEqual([remote]);
  });

  it("removes a shared draft that is gone from the server", () => {
    const plan = planDraftSync({
      environmentId: ENVIRONMENT_ID,
      localDrafts: [makeLocal()],
      remoteDrafts: [],
      syncedDrafts: synced(),
      editingDraftId: null,
    });
    expect(plan.removeLocal).toEqual([DRAFT_ID]);
    expect(plan.push).toEqual([]);
  });

  it("discards a shared draft the user emptied", () => {
    const plan = planDraftSync({
      environmentId: ENVIRONMENT_ID,
      localDrafts: [makeLocal({ hasContent: false })],
      remoteDrafts: [makeRemote()],
      syncedDrafts: synced(),
      editingDraftId: null,
    });
    expect(plan.discard).toEqual([DRAFT_ID]);
    expect(plan.applyRemote).toEqual([]);
  });

  it("says nothing about an empty draft that was never shared", () => {
    const plan = planDraftSync({
      environmentId: ENVIRONMENT_ID,
      localDrafts: [makeLocal({ hasContent: false })],
      remoteDrafts: [],
      syncedDrafts: new Map(),
      editingDraftId: null,
    });
    expect(plan).toEqual({ push: [], discard: [], applyRemote: [], removeLocal: [] });
  });

  it("ignores drafts belonging to another environment", () => {
    const plan = planDraftSync({
      environmentId: ENVIRONMENT_ID,
      localDrafts: [makeLocal({ environmentId: OTHER_ENVIRONMENT_ID })],
      remoteDrafts: [],
      syncedDrafts: new Map(),
      editingDraftId: null,
    });
    expect(plan.push).toEqual([]);
    expect(plan.removeLocal).toEqual([]);
  });
});
