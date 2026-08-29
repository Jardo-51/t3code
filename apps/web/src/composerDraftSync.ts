import type { DraftId, EnvironmentId, OrchestrationDraft } from "@t3tools/contracts";

import {
  compactModelSelectionByProvider,
  composerDraftHasUserContent,
  type ComposerThreadDraftState,
  type DraftSessionState,
  type RemoteComposerDraftContent,
} from "./composerDraftStore";
import type { LocalDraftRecord, SyncedDraftRecord } from "./composerDraftSync.logic";

/**
 * The draft fields that travel between clients. Mirrors `OrchestrationDraft`
 * minus the identity and timestamps the server owns.
 */
export type DraftWireContent = Omit<OrchestrationDraft, "id" | "createdAt" | "updatedAt">;

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

/**
 * Stable hash of everything a push would send. Compared against the last
 * accepted push to decide whether the server is already current, so key order
 * has to be fixed rather than whatever `JSON.stringify` happens to walk.
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
    Object.entries(content.modelSelectionByProvider)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([instanceId, selection]) => [instanceId, selection]),
    content.activeProvider,
    content.modelSelectionExplicit,
    content.deviceOnlyAttachmentCount,
  ]);
}

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
 * planner reasons about. Sessions mid-promotion are left out: their first turn
 * is already starting, and the server retires the draft when the thread lands.
 */
export function collectLocalDraftRecords(state: {
  readonly draftThreadsByThreadKey: Record<string, DraftSessionState>;
  readonly draftsByThreadKey: Record<string, ComposerThreadDraftState>;
}): ReadonlyArray<LocalDraftRecord> {
  const records: LocalDraftRecord[] = [];
  for (const [key, session] of Object.entries(state.draftThreadsByThreadKey)) {
    if (session.promotedTo !== undefined && session.promotedTo !== null) {
      continue;
    }
    const composer = state.draftsByThreadKey[key] ?? null;
    records.push({
      draftId: key as DraftId,
      environmentId: session.environmentId,
      signature: draftSignature(toDraftWireContent(session, composer)),
      hasContent: composerDraftHasUserContent(composer),
    });
  }
  return records;
}

const SYNCED_DRAFTS_STORAGE_KEY = "t3code:synced-drafts:v1";

/**
 * What this device last pushed, per draft. Kept out of the composer store —
 * it is transport bookkeeping, not composer state — but persisted all the
 * same, since after a reload "unchanged since we pushed" and "edited while
 * this client was closed" are indistinguishable without it.
 */
export function loadSyncedDrafts(): Map<DraftId, SyncedDraftRecord> {
  if (typeof localStorage === "undefined") {
    return new Map();
  }
  try {
    const raw = localStorage.getItem(SYNCED_DRAFTS_STORAGE_KEY);
    if (raw === null) {
      return new Map();
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return new Map();
    }
    const entries: Array<[DraftId, SyncedDraftRecord]> = [];
    for (const [draftId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) {
        continue;
      }
      const record = value as Partial<SyncedDraftRecord>;
      if (typeof record.signature !== "string" || typeof record.updatedAt !== "string") {
        continue;
      }
      entries.push([
        draftId as DraftId,
        { signature: record.signature, updatedAt: record.updatedAt },
      ]);
    }
    return new Map(entries);
  } catch {
    // Bookkeeping only. Losing it costs one redundant push per draft, which is
    // strictly better than failing to sync because a stored value went bad.
    return new Map();
  }
}

export function saveSyncedDrafts(synced: ReadonlyMap<DraftId, SyncedDraftRecord>): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(SYNCED_DRAFTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(synced)));
  } catch {
    // A full quota must not break editing; the next push just repeats.
  }
}
