import { describe, expect, it } from "vite-plus/test";

import { DraftId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { OrchestrationShellSnapshot, OrchestrationShellStreamEvent } from "@t3tools/contracts";

import { applyShellStreamEvent } from "./shellReducer.ts";

const baseSnapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 0,
  projects: [],
  threads: [],
  drafts: [],
  updatedAt: "2026-04-01T00:00:00.000Z",
};

const stubProject = {
  id: ProjectId.make("project-1"),
  title: "Test Project",
  workspaceRoot: "/workspace/test",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
} as const;

const stubDraft = {
  id: DraftId.make("draft-1"),
  projectId: ProjectId.make("project-1"),
  threadId: ThreadId.make("thread-1"),
  prompt: "ship the thing",
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: null,
  envMode: "local" as const,
  startFromOrigin: false,
  modelSelectionByProvider: {},
  activeProvider: null,
  modelSelectionExplicit: false,
  deviceOnlyAttachmentCount: 0,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
} as const;

const stubThread = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Test Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  session: null,
} as const;

describe("applyShellStreamEvent", () => {
  it("ignores stale project upserts without mutating the snapshot", () => {
    const snapshotWithProject: OrchestrationShellSnapshot = {
      ...baseSnapshot,
      snapshotSequence: 4,
      projects: [stubProject],
    };

    for (const sequence of [3, 4]) {
      const next = applyShellStreamEvent(snapshotWithProject, {
        kind: "project-upserted",
        sequence,
        project: { ...stubProject, title: "Stale Title" },
      });

      expect(next).toBe(snapshotWithProject);
      expect(next.snapshotSequence).toBe(4);
      expect(next.projects[0]?.title).toBe("Test Project");
    }
  });

  describe("project-upserted", () => {
    it("adds a new project", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 1,
        project: stubProject,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.id).toBe("project-1");
      expect(next.snapshotSequence).toBe(1);
    });

    it("updates an existing project", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const updatedProject = { ...stubProject, title: "Updated Title" };
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 2,
        project: updatedProject,
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.title).toBe("Updated Title");
      expect(next.snapshotSequence).toBe(2);
    });
  });

  describe("project-removed", () => {
    it("removes a project by id", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "project-removed",
        sequence: 3,
        projectId: ProjectId.make("project-1"),
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(0);
      expect(next.snapshotSequence).toBe(3);
    });

    it("drops the project's drafts, which the server retires without its own event", () => {
      const snapshotWithDrafts: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
        drafts: [
          stubDraft,
          { ...stubDraft, id: DraftId.make("draft-2"), projectId: ProjectId.make("project-2") },
        ],
      };

      const next = applyShellStreamEvent(snapshotWithDrafts, {
        kind: "project-removed",
        sequence: 3,
        projectId: ProjectId.make("project-1"),
      });

      expect(next.drafts.map((draft) => draft.id)).toEqual([DraftId.make("draft-2")]);
    });
  });

  describe("thread-upserted", () => {
    it("adds a new thread", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 4,
        thread: stubThread,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.id).toBe("thread-1");
      expect(next.snapshotSequence).toBe(4);
    });

    it("updates an existing thread", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
      };

      const updatedThread = { ...stubThread, title: "Updated Thread" };
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 5,
        thread: updatedThread,
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.title).toBe("Updated Thread");
    });
  });

  describe("thread-removed", () => {
    it("removes a thread by id", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "thread-removed",
        sequence: 6,
        threadId: ThreadId.make("thread-1"),
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(0);
      expect(next.snapshotSequence).toBe(6);
    });
  });

  describe("draft-upserted", () => {
    it("adds a new draft", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "draft-upserted",
        sequence: 7,
        draft: stubDraft,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.drafts).toHaveLength(1);
      expect(next.drafts[0]?.id).toBe("draft-1");
      expect(next.snapshotSequence).toBe(7);
    });

    it("replaces an existing draft rather than appending a second row", () => {
      const snapshotWithDraft: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        drafts: [stubDraft],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "draft-upserted",
        sequence: 8,
        draft: { ...stubDraft, prompt: "ship the other thing" },
      };

      const next = applyShellStreamEvent(snapshotWithDraft, event);

      expect(next.drafts).toHaveLength(1);
      expect(next.drafts[0]?.prompt).toBe("ship the other thing");
    });
  });

  describe("draft-removed", () => {
    it("removes a draft by id", () => {
      const snapshotWithDraft: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        drafts: [stubDraft],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "draft-removed",
        sequence: 9,
        draftId: DraftId.make("draft-1"),
      };

      const next = applyShellStreamEvent(snapshotWithDraft, event);

      expect(next.drafts).toHaveLength(0);
      expect(next.snapshotSequence).toBe(9);
    });
  });

  it("returns original snapshot for unrecognized event kinds", () => {
    const unknownEvent = { kind: "unknown-future-event", sequence: 99 } as any;
    const next = applyShellStreamEvent(baseSnapshot, unknownEvent);
    expect(next).toBe(baseSnapshot);
  });
});
