import {
  DraftId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationDraft,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createEmptyThreadDraft,
  useComposerDraftStore,
  type DraftSessionState,
} from "./composerDraftStore";
import {
  collectLocalDraftRecords,
  draftSignature,
  toDraftSession,
  toDraftWireContent,
  toRemoteComposerContent,
  type StoredSyncedDraft,
} from "./composerDraftSync";

const ENVIRONMENT_ID = EnvironmentId.make("env-1");
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const DRAFT_ID = DraftId.make("draft-1");

function session(overrides: Partial<DraftSessionState> = {}): DraftSessionState {
  return {
    threadId: THREAD_ID,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    logicalProjectKey: "logical-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    envMode: "local",
    startFromOrigin: false,
    ...overrides,
  };
}

function remoteDraft(overrides: Partial<OrchestrationDraft> = {}): OrchestrationDraft {
  return {
    id: DRAFT_ID,
    projectId: PROJECT_ID,
    threadId: THREAD_ID,
    prompt: "written elsewhere",
    runtimeMode: "auto",
    interactionMode: "plan",
    branch: null,
    worktreePath: null,
    envMode: "worktree",
    startFromOrigin: true,
    modelSelectionByProvider: {
      [ProviderInstanceId.make("codex")]: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
    },
    activeProvider: ProviderInstanceId.make("codex"),
    modelSelectionExplicit: true,
    deviceOnlyAttachmentCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:30.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
});

describe("toDraftWireContent", () => {
  it("counts every device-only capture so other clients can say what stayed behind", () => {
    const content = toDraftWireContent(session(), {
      ...createEmptyThreadDraft(),
      prompt: "look at this",
      terminalContexts: [
        {
          id: "ctx-1",
          threadId: THREAD_ID,
          createdAt: "2026-01-01T00:00:00.000Z",
          terminalId: "term-1",
          terminalLabel: "zsh",
          lineStart: 1,
          lineEnd: 2,
          text: "git status",
        },
      ],
    });
    expect(content.prompt).toBe("look at this");
    expect(content.deviceOnlyAttachmentCount).toBe(1);
  });

  it("falls back to the session's modes when the composer has no override", () => {
    const content = toDraftWireContent(session({ runtimeMode: "auto" }), null);
    expect(content.runtimeMode).toBe("auto");
  });
});

describe("draftSignature", () => {
  it("ignores the order model selections happen to be stored in", () => {
    const codex = ProviderInstanceId.make("codex");
    const claude = ProviderInstanceId.make("claudeAgent");
    const base = toDraftWireContent(session(), createEmptyThreadDraft());
    const left = draftSignature({
      ...base,
      modelSelectionByProvider: {
        [codex]: { instanceId: codex, model: "gpt-5.4" },
        [claude]: { instanceId: claude, model: "opus" },
      },
    });
    const right = draftSignature({
      ...base,
      modelSelectionByProvider: {
        [claude]: { instanceId: claude, model: "opus" },
        [codex]: { instanceId: codex, model: "gpt-5.4" },
      },
    });
    expect(left).toBe(right);
  });

  it("changes when an attachment is added", () => {
    const base = toDraftWireContent(session(), createEmptyThreadDraft());
    expect(draftSignature(base)).not.toBe(
      draftSignature({ ...base, deviceOnlyAttachmentCount: 1 }),
    );
  });
});

describe("collectLocalDraftRecords", () => {
  it("reports whether each draft has content worth syncing", () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [DRAFT_ID]: session(),
        "draft-2": session({ threadId: ThreadId.make("thread-2") }),
      },
      draftsByThreadKey: {
        [DRAFT_ID]: { ...createEmptyThreadDraft(), prompt: "typed" },
        "draft-2": createEmptyThreadDraft(),
      },
    });
    const records = collectLocalDraftRecords(useComposerDraftStore.getState(), new Map());
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.draftId === DRAFT_ID)?.hasContent).toBe(true);
    expect(records.find((record) => record.draftId === "draft-2")?.hasContent).toBe(false);
  });

  it("skips a draft whose first turn is already starting", () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [DRAFT_ID]: session({
          promotedTo: { environmentId: ENVIRONMENT_ID, threadId: THREAD_ID },
        }),
      },
      draftsByThreadKey: { [DRAFT_ID]: { ...createEmptyThreadDraft(), prompt: "sent" } },
    });
    expect(collectLocalDraftRecords(useComposerDraftStore.getState(), new Map())).toEqual([]);
  });

  it("stands in for a shared draft the user discarded here, so it is not re-adopted", () => {
    useComposerDraftStore.setState({ draftThreadsByThreadKey: {}, draftsByThreadKey: {} });
    const records = collectLocalDraftRecords(
      useComposerDraftStore.getState(),
      new Map<DraftId, StoredSyncedDraft>([
        [
          DRAFT_ID,
          {
            signature: "sig",
            updatedAt: "2026-01-01T00:00:00.000Z",
            environmentId: ENVIRONMENT_ID,
          },
        ],
      ]),
    );
    expect(records).toEqual([
      {
        draftId: DRAFT_ID,
        environmentId: ENVIRONMENT_ID,
        signature: "sig",
        hasContent: false,
      },
    ]);
  });

  it("prefers the live session over its stand-in", () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: { [DRAFT_ID]: session() },
      draftsByThreadKey: { [DRAFT_ID]: { ...createEmptyThreadDraft(), prompt: "typed" } },
    });
    const records = collectLocalDraftRecords(
      useComposerDraftStore.getState(),
      new Map<DraftId, StoredSyncedDraft>([
        [
          DRAFT_ID,
          {
            signature: "stale",
            updatedAt: "2026-01-01T00:00:00.000Z",
            environmentId: ENVIRONMENT_ID,
          },
        ],
      ]),
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.hasContent).toBe(true);
  });
});

describe("applyRemoteDraft", () => {
  it("adopts a draft from another device and claims the free project slot", () => {
    const draft = remoteDraft();
    useComposerDraftStore.getState().applyRemoteDraft({
      draftId: draft.id,
      logicalProjectKey: "logical-1",
      session: toDraftSession({
        draft,
        environmentId: ENVIRONMENT_ID,
        logicalProjectKey: "logical-1",
        existing: null,
      }),
      composer: toRemoteComposerContent(draft),
    });

    const state = useComposerDraftStore.getState();
    expect(state.getComposerDraft(DRAFT_ID)?.prompt).toBe("written elsewhere");
    expect(state.getDraftSession(DRAFT_ID)?.envMode).toBe("worktree");
    expect(state.getDraftSession(DRAFT_ID)?.startFromOrigin).toBe(true);
    expect(state.logicalProjectDraftThreadKeyByLogicalProjectKey["logical-1"]).toBe(DRAFT_ID);
  });

  it("keeps captures that only exist on this device", () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: { [DRAFT_ID]: session() },
      draftsByThreadKey: {
        [DRAFT_ID]: {
          ...createEmptyThreadDraft(),
          prompt: "local text",
          terminalContexts: [
            {
              id: "ctx-1",
              threadId: THREAD_ID,
              createdAt: "2026-01-01T00:00:00.000Z",
              terminalId: "term-1",
              terminalLabel: "zsh",
              lineStart: 1,
              lineEnd: 2,
              text: "git status",
            },
          ],
        },
      },
    });

    const draft = remoteDraft();
    useComposerDraftStore.getState().applyRemoteDraft({
      draftId: draft.id,
      logicalProjectKey: "logical-1",
      session: toDraftSession({
        draft,
        environmentId: ENVIRONMENT_ID,
        logicalProjectKey: "logical-1",
        existing: null,
      }),
      composer: toRemoteComposerContent(draft),
    });

    const composer = useComposerDraftStore.getState().getComposerDraft(DRAFT_ID);
    expect(composer?.prompt).toBe("written elsewhere");
    expect(composer?.terminalContexts).toHaveLength(1);
  });

  it("does not take a project slot another draft already holds", () => {
    useComposerDraftStore.setState({
      logicalProjectDraftThreadKeyByLogicalProjectKey: { "logical-1": "draft-local" },
    });

    const draft = remoteDraft();
    useComposerDraftStore.getState().applyRemoteDraft({
      draftId: draft.id,
      logicalProjectKey: "logical-1",
      session: toDraftSession({
        draft,
        environmentId: ENVIRONMENT_ID,
        logicalProjectKey: "logical-1",
        existing: null,
      }),
      composer: toRemoteComposerContent(draft),
    });

    const state = useComposerDraftStore.getState();
    expect(state.logicalProjectDraftThreadKeyByLogicalProjectKey["logical-1"]).toBe("draft-local");
    expect(state.getComposerDraft(DRAFT_ID)?.prompt).toBe("written elsewhere");
  });
});
