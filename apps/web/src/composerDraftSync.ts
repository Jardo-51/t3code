import {
  draftSignature,
  isShareableDraftPrompt,
  type DraftWireContent,
  type LocalDraftRecord,
  type SyncedDraftRecord,
} from "@t3tools/client-runtime/state/draft-sync";
import type { DraftId, EnvironmentId, OrchestrationDraft } from "@t3tools/contracts";

import {
  compactModelSelectionByProvider,
  composerDraftHasUserContent,
  type ComposerThreadDraftState,
  type DraftSessionState,
  type RemoteComposerDraftContent,
} from "./composerDraftStore";

/**
 * Everything the user captured that only exists on this device. The count is
 * what other clients render, so an adopted draft says "two attachments live on
 * another device" instead of quietly presenting itself as complete.
 */
function countDeviceOnlyAttachments(composer: ComposerThreadDraftState | null): number {
  if (composer === null) {
    return 0;
  }
  return (
    composer.images.length +
    composer.persistedAttachments.length +
    composer.terminalContexts.length +
    composer.elementContexts.length +
    composer.previewAnnotations.length +
    composer.reviewComments.length
  );
}

export function toDraftWireContent(
  session: DraftSessionState,
  composer: ComposerThreadDraftState | null,
): DraftWireContent {
  return {
    projectId: session.projectId,
    threadId: session.threadId,
    prompt: composer?.prompt ?? "",
    runtimeMode: composer?.runtimeMode ?? session.runtimeMode,
    interactionMode: composer?.interactionMode ?? session.interactionMode,
    branch: session.branch,
    worktreePath: session.worktreePath,
    envMode: session.envMode,
    startFromOrigin: session.startFromOrigin,
    modelSelectionByProvider: compactModelSelectionByProvider(
      composer?.modelSelectionByProvider ?? {},
    ),
    activeProvider: composer?.activeProvider ?? null,
    modelSelectionExplicit: composer?.modelSelectionExplicit ?? false,
    deviceOnlyAttachmentCount: countDeviceOnlyAttachments(composer),
  };
}

export { draftSignature } from "@t3tools/client-runtime/state/draft-sync";
export type { DraftWireContent } from "@t3tools/client-runtime/state/draft-sync";

export function toRemoteComposerContent(draft: OrchestrationDraft): RemoteComposerDraftContent {
  return {
    prompt: draft.prompt,
    modelSelectionByProvider: { ...draft.modelSelectionByProvider },
    activeProvider: draft.activeProvider,
    modelSelectionExplicit: draft.modelSelectionExplicit,
    runtimeMode: draft.runtimeMode,
    interactionMode: draft.interactionMode,
  };
}

export function toDraftSession(input: {
  readonly draft: OrchestrationDraft;
  readonly environmentId: EnvironmentId;
  readonly logicalProjectKey: string;
  readonly existing: DraftSessionState | null;
}): DraftSessionState {
  return {
    threadId: input.draft.threadId,
    environmentId: input.environmentId,
    projectId: input.draft.projectId,
    logicalProjectKey: input.logicalProjectKey,
    createdAt: input.draft.createdAt,
    runtimeMode: input.draft.runtimeMode,
    interactionMode: input.draft.interactionMode,
    branch: input.draft.branch,
    worktreePath: input.draft.worktreePath,
    envMode: input.draft.envMode,
    startFromOrigin: input.draft.startFromOrigin,
    // Promotion is this device's own bookkeeping for a send it started; a
    // remote update never says anything about it.
    ...(input.existing?.promotedTo === undefined ? {} : { promotedTo: input.existing.promotedTo }),
  };
}

/**
 * Snapshot every draft session this device holds, in the shape the sync
 * planner reasons about, plus an unshareable stand-in for every draft this
 * device has published that no longer exists here.
 *
 * Sessions mid-promotion are left out: their first turn is already starting,
 * and the server retires the draft when the thread lands.
 *
 * The stand-ins matter: discarding a draft from the sidebar or from project
 * settings deletes it outright, and without a record saying "this was shared
 * and is now gone" the planner would read the server's copy as a draft started
 * elsewhere and pull it straight back.
 */
export function collectLocalDraftRecords(
  state: {
    readonly draftThreadsByThreadKey: Record<string, DraftSessionState>;
    readonly draftsByThreadKey: Record<string, ComposerThreadDraftState>;
  },
  syncedDrafts: ReadonlyMap<DraftId, StoredSyncedDraft>,
): ReadonlyArray<LocalDraftRecord> {
  const records: LocalDraftRecord[] = [];
  const seen = new Set<string>();
  for (const [key, session] of Object.entries(state.draftThreadsByThreadKey)) {
    if (session.promotedTo !== undefined && session.promotedTo !== null) {
      continue;
    }
    const composer = state.draftsByThreadKey[key] ?? null;
    seen.add(key);
    records.push({
      draftId: key as DraftId,
      environmentId: session.environmentId,
      signature: draftSignature(toDraftWireContent(session, composer)),
      shareable:
        composerDraftHasUserContent(composer) && isShareableDraftPrompt(composer?.prompt ?? ""),
    });
  }
  for (const [draftId, record] of syncedDrafts) {
    if (seen.has(draftId)) {
      continue;
    }
    records.push({
      draftId,
      environmentId: record.environmentId,
      signature: record.signature,
      shareable: false,
    });
  }
  return records;
}

const SYNCED_DRAFTS_STORAGE_PREFIX = "t3code:synced-drafts:v1:";

/**
 * One key per environment. Every environment runs its own reconciliation loop,
 * and a shared key would have them read-modify-writing the same value with no
 * coordination — multi-environment is the normal case here, not the exotic one.
 */
function syncedDraftsStorageKey(environmentId: EnvironmentId): string {
  return `${SYNCED_DRAFTS_STORAGE_PREFIX}${environmentId}`;
}

/**
 * A pushed draft's bookkeeping, plus the environment that owns it. The owner
 * has to be stored rather than looked up, because the entries that matter most
 * are the ones whose local draft is already gone.
 */
export interface StoredSyncedDraft extends SyncedDraftRecord {
  readonly environmentId: EnvironmentId;
}

/**
 * What this device last pushed, per draft. Kept out of the composer store —
 * it is transport bookkeeping, not composer state — but persisted all the
 * same, since after a reload "unchanged since we pushed" and "edited while
 * this client was closed" are indistinguishable without it.
 */
export function loadSyncedDrafts(environmentId: EnvironmentId): Map<DraftId, StoredSyncedDraft> {
  if (typeof localStorage === "undefined") {
    return new Map();
  }
  try {
    const raw = localStorage.getItem(syncedDraftsStorageKey(environmentId));
    if (raw === null) {
      return new Map();
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return new Map();
    }
    const entries: Array<[DraftId, StoredSyncedDraft]> = [];
    for (const [draftId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) {
        continue;
      }
      const record = value as Partial<StoredSyncedDraft>;
      if (
        typeof record.signature !== "string" ||
        typeof record.updatedAt !== "string" ||
        typeof record.environmentId !== "string"
      ) {
        continue;
      }
      entries.push([
        draftId as DraftId,
        {
          signature: record.signature,
          updatedAt: record.updatedAt,
          environmentId: record.environmentId as EnvironmentId,
        },
      ]);
    }
    return new Map(entries);
  } catch {
    // Bookkeeping only. Losing it costs one redundant push per draft, which is
    // strictly better than failing to sync because a stored value went bad.
    return new Map();
  }
}

export function saveSyncedDrafts(
  environmentId: EnvironmentId,
  synced: ReadonlyMap<DraftId, StoredSyncedDraft>,
): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      syncedDraftsStorageKey(environmentId),
      JSON.stringify(Object.fromEntries(synced)),
    );
  } catch {
    // A full quota must not break editing; the next push just repeats.
  }
}
