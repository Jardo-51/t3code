import { describe, expect, it } from "@effect/vitest";
import {
  DraftId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationDraft,
} from "@t3tools/contracts";

import {
  collectHeldDraftIds,
  collectLocalDraftRecords,
  collectUnidentifiedDraftKeys,
  newTaskDraftKey,
  parseNewTaskDraftKey,
  selectRepresentableRemoteDrafts,
  toDraftWireContent,
  toLocalComposerDraft,
} from "./composer-draft-sync";
import type { ComposerDraft, SyncedComposerDraft } from "./use-composer-drafts";

const ENVIRONMENT_ID = EnvironmentId.make("env-1");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("env-2");
const PROJECT_ID = ProjectId.make("project-1");
const DRAFT_KEY = newTaskDraftKey(ENVIRONMENT_ID, PROJECT_ID);
const CODEX = ProviderInstanceId.make("codex");

function draft(overrides: Partial<ComposerDraft> = {}): ComposerDraft {
  return {
    text: "ship the thing",
    attachments: [],
    syncIdentity: { draftId: "draft-1", threadId: "thread-1" },
    ...overrides,
  };
}

function remoteDraft(overrides: Partial<OrchestrationDraft> = {}): OrchestrationDraft {
  return {
    id: DraftId.make("draft-1"),
    projectId: PROJECT_ID,
    threadId: ThreadId.make("thread-1"),
    prompt: "written elsewhere",
    runtimeMode: "auto",
    interactionMode: "plan",
    branch: "main",
    worktreePath: null,
    envMode: "worktree",
    startFromOrigin: true,
    modelSelectionByProvider: {
      [CODEX]: { instanceId: CODEX, model: "gpt-5.4" },
      [ProviderInstanceId.make("claudeAgent")]: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "opus",
      },
    },
    activeProvider: CODEX,
    modelSelectionExplicit: true,
    deviceOnlyAttachmentCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:30.000Z",
    ...overrides,
  };
}

describe("new-task draft keys", () => {
  it("round-trips the environment and project it names", () => {
    expect(parseNewTaskDraftKey(DRAFT_KEY)).toEqual({
      environmentId: ENVIRONMENT_ID,
      projectId: PROJECT_ID,
    });
  });

  it("rejects keys for drafts that belong to a thread rather than a project", () => {
    expect(parseNewTaskDraftKey("env-1:thread-9")).toBeNull();
    expect(parseNewTaskDraftKey("pending-task:message-1")).toBeNull();
  });
});

describe("toDraftWireContent", () => {
  it("publishes the single mobile selection under its own instance", () => {
    const content = toDraftWireContent({
      draft: draft({ modelSelection: { instanceId: CODEX, model: "gpt-5.4" } }),
      projectId: PROJECT_ID,
      threadId: "thread-1",
    });
    expect(content.activeProvider).toBe(CODEX);
    expect(content.modelSelectionByProvider).toEqual({
      [CODEX]: { instanceId: CODEX, model: "gpt-5.4" },
    });
    expect(content.modelSelectionExplicit).toBe(true);
  });

  it("counts attachments that stay on this phone", () => {
    const content = toDraftWireContent({
      draft: draft({
        attachments: [
          {
            type: "image",
            id: "image-1",
            name: "1.png",
            mimeType: "image/png",
            sizeBytes: 10,
            dataUrl: "data:image/png;base64,AA==",
            previewUri: "file:///1.png",
          },
        ],
      }),
      projectId: PROJECT_ID,
      threadId: "thread-1",
    });
    expect(content.deviceOnlyAttachmentCount).toBe(1);
  });

  it("falls back to local mode when the draft never chose a workspace", () => {
    const content = toDraftWireContent({
      draft: draft(),
      projectId: PROJECT_ID,
      threadId: "thread-1",
    });
    expect(content.envMode).toBe("local");
    expect(content.branch).toBeNull();
    expect(content.startFromOrigin).toBe(false);
  });
});

describe("toLocalComposerDraft", () => {
  it("keeps only the selection the writing client had active", () => {
    const local = toLocalComposerDraft(remoteDraft());
    expect(local.modelSelection).toEqual({ instanceId: CODEX, model: "gpt-5.4" });
  });

  it("carries the workspace choice and the identity the draft holds", () => {
    const local = toLocalComposerDraft(remoteDraft());
    expect(local.workspaceSelection).toEqual({
      mode: "worktree",
      branch: "main",
      worktreePath: null,
      startFromOrigin: true,
    });
    expect(local.syncIdentity).toEqual({ draftId: "draft-1", threadId: "thread-1" });
  });
});

describe("collectLocalDraftRecords", () => {
  it("reports drafts for the environment asked about", () => {
    const records = collectLocalDraftRecords({
      environmentId: ENVIRONMENT_ID,
      drafts: {
        [DRAFT_KEY]: draft(),
        [newTaskDraftKey(OTHER_ENVIRONMENT_ID, PROJECT_ID)]: draft({
          syncIdentity: { draftId: "draft-2", threadId: "thread-2" },
        }),
      },
      syncedDrafts: {},
    });
    expect(records.map((record) => record.draftId)).toEqual([DraftId.make("draft-1")]);
    expect(records[0]?.shareable).toBe(true);
  });

  it("stands in for a published draft the user emptied, so it can be discarded", () => {
    const synced: Record<string, SyncedComposerDraft> = {
      "draft-1": {
        draftKey: DRAFT_KEY,
        environmentId: ENVIRONMENT_ID,
        signature: "sig",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const records = collectLocalDraftRecords({
      environmentId: ENVIRONMENT_ID,
      drafts: {},
      syncedDrafts: synced,
    });
    expect(records).toEqual([
      {
        draftId: DraftId.make("draft-1"),
        environmentId: ENVIRONMENT_ID,
        signature: "sig",
        shareable: false,
      },
    ]);
  });

  it("leaves drafts without an identity to the minting pass", () => {
    const records = collectLocalDraftRecords({
      environmentId: ENVIRONMENT_ID,
      drafts: { [DRAFT_KEY]: draft({ syncIdentity: undefined }) },
      syncedDrafts: {},
    });
    expect(records).toEqual([]);
  });
});

describe("collectUnidentifiedDraftKeys", () => {
  it("names drafts with content and no identity yet", () => {
    expect(
      collectUnidentifiedDraftKeys({
        environmentId: ENVIRONMENT_ID,
        drafts: { [DRAFT_KEY]: draft({ syncIdentity: undefined }) },
      }),
    ).toEqual([DRAFT_KEY]);
  });

  it("leaves an empty composer alone", () => {
    expect(
      collectUnidentifiedDraftKeys({
        environmentId: ENVIRONMENT_ID,
        drafts: { [DRAFT_KEY]: { text: "", attachments: [] } },
      }),
    ).toEqual([]);
  });
});

describe("selectRepresentableRemoteDrafts", () => {
  it("shows the most recently edited draft for a project mobile can only show one of", () => {
    const older = remoteDraft({
      id: DraftId.make("draft-old"),
      updatedAt: "2026-01-01T00:00:10.000Z",
    });
    const newer = remoteDraft({
      id: DraftId.make("draft-new"),
      updatedAt: "2026-01-01T00:00:40.000Z",
    });
    expect(selectRepresentableRemoteDrafts([older, newer]).map((draft) => draft.id)).toEqual([
      DraftId.make("draft-new"),
    ]);
  });

  it("keeps one draft per project", () => {
    const first = remoteDraft({ id: DraftId.make("draft-a") });
    const second = remoteDraft({
      id: DraftId.make("draft-b"),
      projectId: ProjectId.make("project-2"),
    });
    expect(selectRepresentableRemoteDrafts([first, second])).toHaveLength(2);
  });

  it("keeps showing the draft this phone already holds instead of a newer sibling", () => {
    const held = remoteDraft({
      id: DraftId.make("draft-held"),
      updatedAt: "2026-01-01T00:00:10.000Z",
    });
    const newer = remoteDraft({
      id: DraftId.make("draft-new"),
      updatedAt: "2026-01-01T00:00:40.000Z",
    });
    expect(
      selectRepresentableRemoteDrafts([held, newer], new Set(["draft-held"])).map(
        (draft) => draft.id,
      ),
    ).toEqual([DraftId.make("draft-held")]);
    expect(
      selectRepresentableRemoteDrafts([newer, held], new Set(["draft-held"])).map(
        (draft) => draft.id,
      ),
    ).toEqual([DraftId.make("draft-held")]);
  });
});

describe("collectHeldDraftIds", () => {
  it("lists the identified new-task drafts of one environment", () => {
    expect(
      collectHeldDraftIds({
        environmentId: ENVIRONMENT_ID,
        drafts: {
          [DRAFT_KEY]: {
            text: "typed",
            attachments: [],
            syncIdentity: { draftId: "draft-1", threadId: "thread-1" },
          },
          "new-task:env-2:project-1": {
            text: "elsewhere",
            attachments: [],
            syncIdentity: { draftId: "draft-2", threadId: "thread-2" },
          },
          "thread:project-1": {
            text: "reply",
            attachments: [],
            syncIdentity: { draftId: "draft-3", threadId: "thread-3" },
          },
        },
      }),
    ).toEqual(new Set(["draft-1"]));
  });
});
