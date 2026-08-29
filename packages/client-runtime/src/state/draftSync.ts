import type { DraftId, EnvironmentId, OrchestrationDraft } from "@t3tools/contracts";

/**
 * One local draft session as the sync layer sees it: an identity, the
 * environment that owns it, and a hash of everything that would be sent.
 */
export interface LocalDraftRecord {
  readonly draftId: DraftId;
  readonly environmentId: EnvironmentId;
  readonly signature: string;
  /**
   * Whether the user has invested content worth syncing. An empty composer is
   * not a draft — it is the blank state every project starts in.
   */
  readonly hasContent: boolean;
}

/**
 * What the server last accepted for a draft. Persisted alongside the drafts
 * themselves so a reload can still tell "unchanged since we pushed" from
 * "edited while this client was closed", which is what decides whether a
 * remote copy may overwrite the local one.
 */
export interface SyncedDraftRecord {
  readonly signature: string;
  readonly updatedAt: string;
}

export interface DraftSyncPlan {
  /** Local drafts whose content the server does not have yet. */
  readonly push: ReadonlyArray<DraftId>;
  /** Drafts emptied locally after having been shared. */
  readonly discard: ReadonlyArray<DraftId>;
  /** Remote drafts to write into the local store. */
  readonly applyRemote: ReadonlyArray<OrchestrationDraft>;
  /** Local drafts discarded or sent on another device. */
  readonly removeLocal: ReadonlyArray<DraftId>;
}

const EMPTY_PLAN: DraftSyncPlan = {
  push: [],
  discard: [],
  applyRemote: [],
  removeLocal: [],
};

/**
 * Decide what one environment's drafts should do next, given what is on this
 * device, what the server holds, and what this device last pushed.
 *
 * The rule everywhere is last-write-wins on whole drafts: a composer is one
 * indivisible state, and merging fields from two devices would let a deletion
 * on one lose to a stale keystroke on the other. `editingDraftId` is the one
 * exception — the draft the user is typing into is never overwritten, however
 * new the remote copy is, because silently rewriting a focused composer is
 * worse than showing a stale one until they move on.
 *
 * `remoteDrafts` is null until this environment's snapshot has loaded. An
 * environment that has not answered yet is not an environment holding no
 * drafts, and conflating the two would read every cold start and every
 * unreachable machine as "everything was discarded elsewhere".
 */
export function planDraftSync(input: {
  readonly environmentId: EnvironmentId;
  readonly localDrafts: ReadonlyArray<LocalDraftRecord>;
  readonly remoteDrafts: ReadonlyArray<OrchestrationDraft> | null;
  readonly syncedDrafts: ReadonlyMap<DraftId, SyncedDraftRecord>;
  readonly editingDraftId: DraftId | null;
}): DraftSyncPlan {
  if (input.remoteDrafts === null) {
    return EMPTY_PLAN;
  }
  const locals = input.localDrafts.filter((draft) => draft.environmentId === input.environmentId);
  if (locals.length === 0 && input.remoteDrafts.length === 0) {
    return EMPTY_PLAN;
  }

  const localById = new Map(locals.map((draft) => [draft.draftId, draft] as const));
  const remoteById = new Map(input.remoteDrafts.map((draft) => [draft.id, draft] as const));

  const push: DraftId[] = [];
  const discard: DraftId[] = [];
  const applyRemote: OrchestrationDraft[] = [];
  const removeLocal: DraftId[] = [];

  for (const local of locals) {
    const synced = input.syncedDrafts.get(local.draftId);

    if (!local.hasContent) {
      // Emptying a draft is how the user discards it. Only say so for drafts
      // other devices actually know about.
      if (synced !== undefined) {
        discard.push(local.draftId);
      }
      continue;
    }

    if (synced === undefined || synced.signature !== local.signature) {
      push.push(local.draftId);
      continue;
    }

    const remote = remoteById.get(local.draftId);
    if (remote === undefined) {
      // We pushed it and the server no longer has it: another device discarded
      // it, or started its first turn.
      removeLocal.push(local.draftId);
      continue;
    }

    if (local.draftId !== input.editingDraftId && remote.updatedAt > synced.updatedAt) {
      applyRemote.push(remote);
    }
  }

  for (const remote of input.remoteDrafts) {
    if (localById.has(remote.id)) {
      continue;
    }
    applyRemote.push(remote);
  }

  return { push, discard, applyRemote, removeLocal };
}

/**
 * The draft fields that travel between clients: `OrchestrationDraft` minus the
 * identity and timestamps the server owns.
 */
export type DraftWireContent = Omit<OrchestrationDraft, "id" | "createdAt" | "updatedAt">;

/**
 * Stable hash of everything a push would send, compared against the last
 * accepted push to decide whether the server is already current. Both clients
 * hash the same way, so a draft that moves between them does not look edited
 * on arrival — which means key order has to be fixed rather than whatever
 * `JSON.stringify` happens to walk.
 */
export function draftSignature(content: DraftWireContent): string {
  return JSON.stringify([
    content.projectId,
    content.threadId,
    content.prompt,
    content.runtimeMode,
    content.interactionMode,
    content.branch,
    content.worktreePath,
    content.envMode,
    content.startFromOrigin,
    Object.entries(content.modelSelectionByProvider).toSorted(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
    content.activeProvider,
    content.modelSelectionExplicit,
    content.deviceOnlyAttachmentCount,
  ]);
}
