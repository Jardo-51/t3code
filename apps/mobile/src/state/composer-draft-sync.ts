import {
  draftSignature,
  type DraftWireContent,
  type LocalDraftRecord,
} from "@t3tools/client-runtime/state/draft-sync";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DraftId,
  ProjectId,
  ThreadId,
  type EnvironmentId,
  type OrchestrationDraft,
} from "@t3tools/contracts";

import { scopedProjectKey } from "../lib/scopedEntities";
import type { ComposerDraft, SyncedComposerDraft } from "./use-composer-drafts";

const NEW_TASK_DRAFT_PREFIX = "new-task:";

/**
 * Mobile keys its new-task drafts by project, so only those participate in
 * sync. Drafts scoped to an open thread or a queued message are replies to
 * something that already exists, which the thread itself already carries.
 */
export function newTaskDraftKey(environmentId: EnvironmentId, projectId: ProjectId): string {
  return `${NEW_TASK_DRAFT_PREFIX}${scopedProjectKey(environmentId, projectId)}`;
}

export function parseNewTaskDraftKey(
  draftKey: string,
): { readonly environmentId: EnvironmentId; readonly projectId: ProjectId } | null {
  if (!draftKey.startsWith(NEW_TASK_DRAFT_PREFIX)) {
    return null;
  }
  const scoped = draftKey.slice(NEW_TASK_DRAFT_PREFIX.length);
  const separator = scoped.indexOf(":");
  if (separator <= 0 || separator === scoped.length - 1) {
    return null;
  }
  return {
    environmentId: scoped.slice(0, separator) as EnvironmentId,
    projectId: ProjectId.make(scoped.slice(separator + 1)),
  };
}

/**
 * Whether the user has invested something worth sharing. Deliberately stricter
 * than the store's own emptiness rule: a draft holding only a model or mode
 * choice is an ambient default, not pending work, and publishing those would
 * put a row on every other client for a project nobody has typed into.
 */
export function draftHasUserContent(draft: ComposerDraft): boolean {
  return draft.text.trim().length > 0 || draft.attachments.length > 0;
}

export function toDraftWireContent(input: {
  readonly draft: ComposerDraft;
  readonly projectId: ProjectId;
  readonly threadId: string;
}): DraftWireContent {
  const workspace = input.draft.workspaceSelection;
  const selection = input.draft.modelSelection;
  return {
    projectId: input.projectId,
    threadId: ThreadId.make(input.threadId),
    prompt: input.draft.text,
    runtimeMode: input.draft.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode: input.draft.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: workspace?.branch ?? null,
    worktreePath: workspace?.worktreePath ?? null,
    envMode: workspace?.mode ?? "local",
    startFromOrigin: workspace?.startFromOrigin ?? false,
    // Mobile holds one selection rather than one per provider. Publishing it
    // under its own instance id keeps the shared shape without inventing
    // selections for providers this phone never chose.
    modelSelectionByProvider: selection === undefined ? {} : { [selection.instanceId]: selection },
    activeProvider: selection?.instanceId ?? null,
    modelSelectionExplicit: selection !== undefined,
    deviceOnlyAttachmentCount: input.draft.attachments.length,
  };
}

/**
 * The half of a remote draft mobile can represent. Model selections for
 * providers other than the active one are dropped: the mobile composer has a
 * single model, and carrying invisible selections would resurrect them the
 * next time this phone published the draft.
 */
export function toLocalComposerDraft(
  draft: OrchestrationDraft,
): Pick<
  ComposerDraft,
  | "text"
  | "modelSelection"
  | "runtimeMode"
  | "interactionMode"
  | "workspaceSelection"
  | "syncIdentity"
> {
  const activeSelection =
    draft.activeProvider === null
      ? undefined
      : draft.modelSelectionByProvider[draft.activeProvider];
  return {
    text: draft.prompt,
    ...(activeSelection === undefined ? {} : { modelSelection: activeSelection }),
    runtimeMode: draft.runtimeMode,
    interactionMode: draft.interactionMode,
    workspaceSelection: {
      mode: draft.envMode,
      branch: draft.branch,
      worktreePath: draft.worktreePath,
      ...(draft.startFromOrigin ? { startFromOrigin: true } : {}),
    },
    syncIdentity: { draftId: draft.id, threadId: draft.threadId },
  };
}

/**
 * Snapshot this phone's new-task drafts for one environment, plus a stand-in
 * for every draft it has published that no longer exists here.
 *
 * The stand-ins matter: emptying a mobile draft deletes it outright, and
 * without a record saying "this was shared and is now gone" the planner would
 * read the server's copy as a draft started elsewhere and pull it straight
 * back.
 */
export function collectLocalDraftRecords(input: {
  readonly environmentId: EnvironmentId;
  readonly drafts: Record<string, ComposerDraft>;
  readonly syncedDrafts: Record<string, SyncedComposerDraft>;
}): ReadonlyArray<LocalDraftRecord> {
  const records: LocalDraftRecord[] = [];
  const seen = new Set<string>();

  for (const [draftKey, draft] of Object.entries(input.drafts)) {
    const parsed = parseNewTaskDraftKey(draftKey);
    if (parsed === null || parsed.environmentId !== input.environmentId) {
      continue;
    }
    const identity = draft.syncIdentity;
    if (identity === undefined) {
      continue;
    }
    seen.add(identity.draftId);
    records.push({
      draftId: DraftId.make(identity.draftId),
      environmentId: input.environmentId,
      signature: draftSignature(
        toDraftWireContent({
          draft,
          projectId: parsed.projectId,
          threadId: identity.threadId,
        }),
      ),
      hasContent: draftHasUserContent(draft),
    });
  }

  for (const [draftId, record] of Object.entries(input.syncedDrafts)) {
    if (record.environmentId !== input.environmentId || seen.has(draftId)) {
      continue;
    }
    records.push({
      draftId: DraftId.make(draftId),
      environmentId: input.environmentId,
      signature: record.signature,
      hasContent: false,
    });
  }

  return records;
}

/**
 * Drafts this phone has not published yet, because they gained content before
 * anything minted an identity for them.
 */
export function collectUnidentifiedDraftKeys(input: {
  readonly environmentId: EnvironmentId;
  readonly drafts: Record<string, ComposerDraft>;
}): ReadonlyArray<string> {
  const keys: string[] = [];
  for (const [draftKey, draft] of Object.entries(input.drafts)) {
    const parsed = parseNewTaskDraftKey(draftKey);
    if (parsed === null || parsed.environmentId !== input.environmentId) {
      continue;
    }
    if (draft.syncIdentity === undefined && draftHasUserContent(draft)) {
      keys.push(draftKey);
    }
  }
  return keys;
}

/**
 * Which remote drafts this phone can show. Mobile keeps one new-task draft per
 * project, so a project holding several drafts is represented by a single one;
 * the rest stay visible on the clients that can list them.
 *
 * The draft this phone already holds wins over a newer sibling. Picking purely
 * by recency would let a draft written elsewhere evict the one in front of the
 * user, and the evicted draft would then look locally discarded.
 */
export function selectRepresentableRemoteDrafts(
  remoteDrafts: ReadonlyArray<OrchestrationDraft>,
  heldDraftIds: ReadonlySet<string> = new Set(),
): ReadonlyArray<OrchestrationDraft> {
  const byProject = new Map<string, OrchestrationDraft>();
  for (const draft of remoteDrafts) {
    const current = byProject.get(draft.projectId);
    if (current === undefined) {
      byProject.set(draft.projectId, draft);
      continue;
    }
    if (heldDraftIds.has(current.id)) {
      continue;
    }
    if (heldDraftIds.has(draft.id) || draft.updatedAt > current.updatedAt) {
      byProject.set(draft.projectId, draft);
    }
  }
  return Array.from(byProject.values());
}

/** The draft ids this phone currently has a new-task composer for. */
export function collectHeldDraftIds(input: {
  readonly environmentId: EnvironmentId;
  readonly drafts: Record<string, ComposerDraft>;
}): ReadonlySet<string> {
  const held = new Set<string>();
  for (const [draftKey, draft] of Object.entries(input.drafts)) {
    const parsed = parseNewTaskDraftKey(draftKey);
    if (parsed === null || parsed.environmentId !== input.environmentId) {
      continue;
    }
    if (draft.syncIdentity !== undefined) {
      held.add(draft.syncIdentity.draftId);
    }
  }
  return held;
}
