import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { DiscardDraftInput, UpsertDraftInput } from "@t3tools/client-runtime/state/drafts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { DraftId, EnvironmentId, OrchestrationDraft } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "@tanstack/react-router";

import { useComposerDraftStore } from "../composerDraftStore";
import {
  collectLocalDraftRecords,
  draftSignature,
  loadSyncedDrafts,
  saveSyncedDrafts,
  toDraftSession,
  toDraftWireContent,
  toRemoteComposerContent,
} from "../composerDraftSync";
import { planDraftSync } from "@t3tools/client-runtime/state/draft-sync";
import { environmentCatalog } from "../connection/catalog";
import { useClientSettings } from "../hooks/useSettings";
import {
  deriveLogicalProjectKeyFromRef,
  resolveProjectGroupingMode,
  selectProjectGroupingSettings,
  type ProjectGroupingSettings,
} from "../logicalProject";
import { draftEnvironment } from "../state/drafts";
import { useProjects } from "../state/entities";
import { environmentShell } from "../state/shell";
import { useAtomCommand } from "../state/use-atom-command";
import { resolveThreadRouteTarget } from "../threadRoutes";

/**
 * How long editing settles before a draft goes over the wire. Typing already
 * persists locally on its own shorter debounce; this is the network's cadence,
 * chosen so a typed sentence costs one message rather than one per pause.
 */
const LOCAL_EDIT_DEBOUNCE_MS = 1_500;

/**
 * Remote changes have already been debounced by the device that made them, so
 * they only wait long enough to batch a burst of stream events.
 */
const REMOTE_CHANGE_DEBOUNCE_MS = 100;

type DraftCommand<Input> = (value: {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}) => Promise<{ readonly _tag: string }>;

/**
 * Mirrors this device's unsent drafts through each environment that owns them,
 * so a prompt started on one client shows up on the rest.
 *
 * One child per environment: a draft belongs to the machine that will run it,
 * and an offline environment simply stops syncing its own drafts without
 * holding up the others.
 */
export function ComposerDraftSync() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const environmentIds = useMemo(() => Array.from(catalog.entries.keys()), [catalog]);
  return (
    <>
      {environmentIds.map((environmentId) => (
        <EnvironmentDraftSync key={environmentId} environmentId={environmentId} />
      ))}
    </>
  );
}

function EnvironmentDraftSync(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const shellState = useAtomValue(environmentShell.stateValueAtom(environmentId));
  // Draft writes are best-effort background traffic: a failed push retries on
  // the next edit, and a toast for it would interrupt typing to report
  // something the user never asked for.
  const upsertDraft = useAtomCommand(draftEnvironment.upsert, { reportFailure: false });
  const discardDraft = useAtomCommand(draftEnvironment.discard, { reportFailure: false });
  const projects = useProjects();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const router = useRouter();

  // Null until this environment has answered. An environment that has not
  // loaded yet is not an environment holding no drafts, and reconciling
  // against the difference would clear this device's drafts on every cold
  // start and for every machine that is currently unreachable.
  const remoteDrafts = useMemo(
    () =>
      Option.match(shellState.snapshot, {
        onNone: (): ReadonlyArray<OrchestrationDraft> | null => null,
        onSome: (snapshot) => snapshot.drafts,
      }),
    [shellState.snapshot],
  );

  // Held in a ref so a pending sync always reads current inputs, instead of
  // being cancelled and rescheduled on every keystroke.
  const inputsRef = useRef({ remoteDrafts, projects, groupingSettings });
  inputsRef.current = { remoteDrafts, projects, groupingSettings };

  const commandsRef = useRef({ upsertDraft, discardDraft });
  commandsRef.current = { upsertDraft, discardDraft };

  const routerRef = useRef(router);
  routerRef.current = router;

  // When the composer last changed, captured as it happens rather than when
  // the push goes out. Last-write-wins compares these across devices, so a
  // write delayed by the debounce or a slow link has to still carry the moment
  // the user typed, or the slower connection would win.
  const editedAtRef = useRef<string | null>(null);

  // Held across effect runs rather than inside one. `remoteDrafts` changes
  // identity whenever the server echoes this device's own push, so the effect
  // re-runs mid-pass; per-run state would let the replacement start a second
  // pass over the same bookkeeping while the first is still awaiting.
  const runStateRef = useRef({ running: false, rerunRequested: false });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const runState = runStateRef.current;
    // Object rather than a plain flag so the async loop below observes the
    // unmount that happens between its awaits.
    const lifecycle = { disposed: false };

    const run = async () => {
      if (runState.running) {
        // A sync writes to the store, which would re-enter this immediately.
        // Coalesce instead, and take one more pass afterwards so an edit made
        // mid-flight is not left unsent.
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
            projects: inputsRef.current.projects,
            groupingSettings: inputsRef.current.groupingSettings,
            upsertDraft: commandsRef.current.upsertDraft,
            discardDraft: commandsRef.current.discardDraft,
            editingDraftId: resolveEditingDraftId(routerRef.current),
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

    const unsubscribe = useComposerDraftStore.subscribe(() => {
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

  return null;
}

function resolveEditingDraftId(router: ReturnType<typeof useRouter>): DraftId | null {
  const params = router.state.matches[router.state.matches.length - 1]?.params ?? {};
  const target = resolveThreadRouteTarget(params);
  return target?.kind === "draft" ? target.draftId : null;
}

async function syncEnvironmentDrafts(input: {
  readonly environmentId: EnvironmentId;
  readonly remoteDrafts: ReadonlyArray<OrchestrationDraft> | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly groupingSettings: ProjectGroupingSettings;
  readonly upsertDraft: DraftCommand<UpsertDraftInput>;
  readonly discardDraft: DraftCommand<DiscardDraftInput>;
  readonly editingDraftId: DraftId | null;
  /** When the edits in this pass were made, not when the pass reached the network. */
  readonly editedAt: string;
}): Promise<void> {
  const remoteDrafts = input.remoteDrafts;
  if (remoteDrafts === null) {
    // Nothing to reconcile against yet, and pruning bookkeeping here would
    // forget drafts that only the unloaded snapshot knows about.
    return;
  }

  const store = useComposerDraftStore.getState();
  const synced = loadSyncedDrafts(input.environmentId);

  // Bookkeeping for a draft that exists neither here nor on the server refers
  // to nothing: it was sent, or discarded from another client. Reaping it
  // before planning keeps it from becoming a stand-in that retries a discard
  // for something already gone.
  let bookkeepingChanged = false;
  const remoteIds = new Set<string>(remoteDrafts.map((draft) => draft.id));
  for (const [draftId, record] of synced) {
    if (record.environmentId !== input.environmentId) {
      continue;
    }
    if (store.draftThreadsByThreadKey[draftId] !== undefined || remoteIds.has(draftId)) {
      continue;
    }
    synced.delete(draftId);
    bookkeepingChanged = true;
  }

  const localDrafts = collectLocalDraftRecords(store, synced);
  const plan = planDraftSync({
    environmentId: input.environmentId,
    localDrafts,
    remoteDrafts,
    syncedDrafts: synced,
    editingDraftId: input.editingDraftId,
  });

  for (const draftId of plan.push) {
    const session = store.getDraftSession(draftId);
    if (session === null) {
      continue;
    }
    const content = toDraftWireContent(session, store.getComposerDraft(draftId));
    const result = await input.upsertDraft({
      environmentId: input.environmentId,
      input: { ...content, draftId, createdAt: input.editedAt },
    });
    if (result._tag !== "Success") {
      continue;
    }
    synced.set(draftId, {
      signature: draftSignature(content),
      updatedAt: input.editedAt,
      environmentId: input.environmentId,
    });
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
    synced.delete(draftId);
    bookkeepingChanged = true;
  }

  for (const draft of plan.applyRemote) {
    applyRemoteDraft({
      draft,
      environmentId: input.environmentId,
      projects: input.projects,
      groupingSettings: input.groupingSettings,
    });
    // Record what this device now holds rather than what arrived: the local
    // copy keeps its own device-only attachments, so its signature differs
    // from the remote one and would otherwise look like an unsent edit.
    const applied = useComposerDraftStore.getState();
    const session = applied.getDraftSession(draft.id);
    if (session === null) {
      continue;
    }
    synced.set(draft.id, {
      signature: draftSignature(toDraftWireContent(session, applied.getComposerDraft(draft.id))),
      updatedAt: draft.updatedAt,
      environmentId: input.environmentId,
    });
    bookkeepingChanged = true;
  }

  for (const draftId of plan.removeLocal) {
    useComposerDraftStore.getState().clearDraftThread(draftId);
    synced.delete(draftId);
    bookkeepingChanged = true;
  }

  if (bookkeepingChanged) {
    saveSyncedDrafts(input.environmentId, synced);
  }
}

function applyRemoteDraft(input: {
  readonly draft: OrchestrationDraft;
  readonly environmentId: EnvironmentId;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly groupingSettings: ProjectGroupingSettings;
}): void {
  const projectRef = scopeProjectRef(input.environmentId, input.draft.projectId);
  const project =
    input.projects.find(
      (candidate) =>
        candidate.environmentId === input.environmentId && candidate.id === input.draft.projectId,
    ) ?? null;
  const logicalProjectKey = deriveLogicalProjectKeyFromRef(
    projectRef,
    project,
    project === null
      ? undefined
      : { groupingMode: resolveProjectGroupingMode(project, input.groupingSettings) },
  );
  const store = useComposerDraftStore.getState();
  store.applyRemoteDraft({
    draftId: input.draft.id,
    logicalProjectKey,
    session: toDraftSession({
      draft: input.draft,
      environmentId: input.environmentId,
      logicalProjectKey,
      existing: store.getDraftSession(input.draft.id),
    }),
    composer: toRemoteComposerContent(input.draft),
  });
}
