import { useAtomValue } from "@effect/atom-react";
import { draftSignature, planDraftSync } from "@t3tools/client-runtime/state/draft-sync";
import type { DiscardDraftInput, UpsertDraftInput } from "@t3tools/client-runtime/state/drafts";
import type { DraftId, EnvironmentId, OrchestrationDraft, ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useRef } from "react";

import { appAtomRegistry } from "./atom-registry";
import { uuidv4 } from "../lib/uuid";
import {
  collectHeldDraftIds,
  collectLocalDraftRecords,
  collectUnidentifiedDraftKeys,
  draftHasUserContent,
  newTaskDraftKey,
  parseNewTaskDraftKey,
  selectRepresentableRemoteDrafts,
  toDraftWireContent,
  toLocalComposerDraft,
} from "./composer-draft-sync";
import { draftEnvironment } from "./drafts";
import { environmentShell } from "./shell";
import { useAtomCommand } from "./use-atom-command";
import {
  applyRemoteComposerDraft,
  clearComposerDraft,
  composerDraftsAtom,
  ensureComposerDraftsLoaded,
  setComposerDraftSyncIdentity,
  setSyncedComposerDrafts,
  syncedComposerDraftsAtom,
  whenComposerDraftsLoaded,
  type ComposerDraft,
  type ComposerDraftSyncIdentity,
  type SyncedComposerDraft,
} from "./use-composer-drafts";

/**
 * How long editing settles before a draft goes over the wire. Local
 * persistence already has its own shorter debounce; this is the network's
 * cadence, so a typed sentence costs one message rather than one per pause.
 */
const LOCAL_EDIT_DEBOUNCE_MS = 1_500;

/** Remote changes were already debounced by the device that made them. */
const REMOTE_CHANGE_DEBOUNCE_MS = 100;

type DraftCommand<Input> = (value: {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}) => Promise<{ readonly _tag: string }>;

/**
 * Mirrors this phone's unsent new-task drafts through the environment that
 * will run them, and adopts the drafts other clients started there.
 *
 * Mobile keeps one new-task draft per project, so a project holding several
 * drafts shows one of them here — the one this phone already holds, otherwise
 * the most recently edited — while the rest stay listed on clients that can
 * show them all.
 */
export function useComposerDraftSync(environmentId: EnvironmentId): void {
  const shellState = useAtomValue(environmentShell.stateValueAtom(environmentId));
  // Draft writes are background traffic: a failed push retries on the next
  // edit, and a toast would interrupt typing to report something the user
  // never asked for.
  const upsertDraft = useAtomCommand(draftEnvironment.upsert, { reportFailure: false });
  const discardDraft = useAtomCommand(draftEnvironment.discard, { reportFailure: false });

  // Null until this environment has answered. An environment that has not
  // loaded yet is not an environment holding no drafts, and reconciling
  // against the difference would clear this phone's drafts every time the app
  // is opened out of reach of the machine that runs them.
  const remoteDrafts = Option.match(shellState.snapshot, {
    onNone: (): ReadonlyArray<OrchestrationDraft> | null => null,
    onSome: (snapshot) => snapshot.drafts,
  });

  const inputsRef = useRef({ remoteDrafts, upsertDraft, discardDraft });
  inputsRef.current = { remoteDrafts, upsertDraft, discardDraft };

  // When the composer last changed, captured as it happens rather than when
  // the push goes out. Last-write-wins compares these across devices, so a
  // write delayed by the debounce or a slow link has to still carry the moment
  // the user typed, or the slower connection would win.
  const editedAtRef = useRef<string | null>(null);
  // Held across effect runs: `remoteDrafts` changes identity whenever the
  // server echoes this phone's own push, so a per-run guard would let the
  // replacement start a second pass over the same bookkeeping.
  const runStateRef = useRef({ running: false, rerunRequested: false });

  useEffect(() => {
    ensureComposerDraftsLoaded();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const runState = runStateRef.current;
    // Object rather than a plain flag so the async loop below observes the
    // unmount that happens between its awaits.
    const lifecycle = { disposed: false };

    const run = async () => {
      if (runState.running) {
        // A pass writes drafts, which would re-enter this immediately.
        // Coalesce, then take one more pass so an edit made mid-flight is not
        // left unsent.
        runState.rerunRequested = true;
        return;
      }
      runState.running = true;
      try {
        do {
          runState.rerunRequested = false;
          await syncEnvironmentDrafts({
            environmentId,
            remoteDrafts: inputsRef.current.remoteDrafts,
            upsertDraft: inputsRef.current.upsertDraft,
            discardDraft: inputsRef.current.discardDraft,
            editedAt: editedAtRef.current ?? new Date().toISOString(),
          });
          editedAtRef.current = null;
        } while (runState.rerunRequested);
      } finally {
        runState.running = false;
      }
    };

    const schedule = (delayMs: number) => {
      if (lifecycle.disposed) {
        return;
      }
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    };

    const unsubscribe = appAtomRegistry.subscribe(composerDraftsAtom, () => {
      editedAtRef.current ??= new Date().toISOString();
      schedule(LOCAL_EDIT_DEBOUNCE_MS);
    });
    schedule(REMOTE_CHANGE_DEBOUNCE_MS);

    return () => {
      lifecycle.disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      unsubscribe();
    };
  }, [environmentId, remoteDrafts]);
}

async function syncEnvironmentDrafts(input: {
  readonly environmentId: EnvironmentId;
  readonly remoteDrafts: ReadonlyArray<OrchestrationDraft> | null;
  readonly upsertDraft: DraftCommand<UpsertDraftInput>;
  readonly discardDraft: DraftCommand<DiscardDraftInput>;
  /** When the edits in this pass were made, not when the pass reached the network. */
  readonly editedAt: string;
}): Promise<void> {
  if (input.remoteDrafts === null) {
    return;
  }
  // Persisted drafts land asynchronously, and a pre-hydration store reads as
  // an empty phone — which the planner would publish as a round of discards.
  await whenComposerDraftsLoaded();

  // A draft that gained content before anything named it cannot be published,
  // so mint identity first and let the same pass push it.
  for (const draftKey of collectUnidentifiedDraftKeys({
    environmentId: input.environmentId,
    drafts: appAtomRegistry.get(composerDraftsAtom),
  })) {
    setComposerDraftSyncIdentity(draftKey, { draftId: uuidv4(), threadId: uuidv4() });
  }

  const drafts = appAtomRegistry.get(composerDraftsAtom);
  const synced = { ...appAtomRegistry.get(syncedComposerDraftsAtom) };
  const held = collectHeldDraftIds({ environmentId: input.environmentId, drafts });

  // Bookkeeping for a draft that exists neither here nor on the server refers
  // to nothing: it was sent, or discarded from another client. Reaping it
  // before planning keeps it from becoming a stand-in that retries a discard
  // for something already gone.
  let bookkeepingChanged = false;
  const remoteIds = new Set<string>(input.remoteDrafts.map((draft) => draft.id));
  for (const [draftId, record] of Object.entries(synced)) {
    if (record.environmentId !== input.environmentId) {
      continue;
    }
    if (held.has(draftId) || remoteIds.has(draftId)) {
      continue;
    }
    delete synced[draftId];
    bookkeepingChanged = true;
  }

  const plan = planDraftSync({
    environmentId: input.environmentId,
    localDrafts: collectLocalDraftRecords({
      environmentId: input.environmentId,
      drafts,
      syncedDrafts: synced,
    }),
    // The planner gets every remote draft, not the subset mobile can show. A
    // draft filtered out for presentation is still on the server, and letting
    // that absence reach the planner would read as a discard.
    remoteDrafts: input.remoteDrafts,
    syncedDrafts: new Map(
      Object.entries(synced).map(
        ([draftId, record]) =>
          [
            draftId as DraftId,
            { signature: record.signature, updatedAt: record.updatedAt },
          ] as const,
      ),
    ),
    // The mobile composer has no route-level notion of "the draft I am typing
    // in": the new-task screen owns whichever project is selected. Local edits
    // still win by signature, so an in-progress draft is pushed rather than
    // overwritten.
    editingDraftId: null,
  });

  for (const draftId of plan.push) {
    const entry = findDraftById(drafts, draftId);
    if (entry === null) {
      continue;
    }
    const content = toDraftWireContent({
      draft: entry.draft,
      projectId: entry.projectId,
      threadId: entry.identity.threadId,
    });
    const result = await input.upsertDraft({
      environmentId: input.environmentId,
      input: { ...content, draftId, createdAt: input.editedAt },
    });
    if (result._tag !== "Success") {
      continue;
    }
    synced[draftId] = {
      draftKey: entry.draftKey,
      environmentId: input.environmentId,
      signature: draftSignature(content),
      updatedAt: input.editedAt,
    };
    bookkeepingChanged = true;
  }

  for (const draftId of plan.discard) {
    const result = await input.discardDraft({
      environmentId: input.environmentId,
      input: { draftId, createdAt: input.editedAt },
    });
    if (result._tag !== "Success") {
      continue;
    }
    delete synced[draftId];
    bookkeepingChanged = true;
  }

  // Mobile has one new-task composer per project, so only one draft per
  // project can be shown; the rest stay listed on clients that can show them.
  for (const draft of selectRepresentableRemoteDrafts(plan.applyRemote, held)) {
    const draftKey = newTaskDraftKey(input.environmentId, draft.projectId);
    // One composer per project: a remote draft may not evict typed text that
    // belongs to a different draft. The occupant is published in this same
    // pass, so nothing is lost by showing it instead.
    const occupant = appAtomRegistry.get(composerDraftsAtom)[draftKey];
    if (
      occupant !== undefined &&
      occupant.syncIdentity !== undefined &&
      occupant.syncIdentity.draftId !== draft.id &&
      draftHasUserContent(occupant)
    ) {
      continue;
    }
    applyRemoteComposerDraft(draftKey, toLocalComposerDraft(draft));
    // Record what this phone now holds rather than what arrived: the local
    // copy keeps its own attachments, so its signature differs from the remote
    // one and would otherwise look like an unsent edit.
    const applied = appAtomRegistry.get(composerDraftsAtom)[draftKey];
    if (applied === undefined) {
      continue;
    }
    synced[draft.id] = {
      draftKey,
      environmentId: input.environmentId,
      signature: draftSignature(
        toDraftWireContent({
          draft: applied,
          projectId: draft.projectId,
          threadId: draft.threadId,
        }),
      ),
      updatedAt: draft.updatedAt,
    };
    bookkeepingChanged = true;
  }

  // Read the store again rather than reusing the pre-adoption snapshot: the
  // loop above rewrote project keys, and a stale lookup would delete the draft
  // that was just adopted into the key this one used to hold.
  const adopted = appAtomRegistry.get(composerDraftsAtom);
  for (const draftId of plan.removeLocal) {
    const entry = findDraftById(adopted, draftId);
    if (entry !== null) {
      clearComposerDraft(entry.draftKey);
    }
    delete synced[draftId];
    bookkeepingChanged = true;
  }

  if (bookkeepingChanged) {
    setSyncedComposerDrafts(synced);
  }
}

function findDraftById(
  drafts: Record<string, ComposerDraft>,
  draftId: DraftId,
): {
  readonly draftKey: string;
  readonly draft: ComposerDraft;
  readonly projectId: ProjectId;
  readonly identity: ComposerDraftSyncIdentity;
} | null {
  for (const [draftKey, draft] of Object.entries(drafts)) {
    const identity = draft.syncIdentity;
    if (identity === undefined || identity.draftId !== draftId) {
      continue;
    }
    const parsed = parseNewTaskDraftKey(draftKey);
    if (parsed === null) {
      continue;
    }
    return { draftKey, draft, projectId: parsed.projectId, identity };
  }
  return null;
}

export type { SyncedComposerDraft };
