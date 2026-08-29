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

  const remoteDrafts = useMemo(
    () =>
      Option.match(shellState.snapshot, {
        onNone: (): ReadonlyArray<OrchestrationDraft> => [],
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

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let rerunRequested = false;
    // Object rather than a plain flag so the async loop below observes the
    // unmount that happens between its awaits.
    const lifecycle = { disposed: false };

    const run = async () => {
      if (running) {
        // A sync writes to the store, which would re-enter this immediately.
        // Coalesce instead, and take one more pass afterwards so an edit made
        // mid-flight is not left unsent.
        rerunRequested = true;
        return;
      }
      running = true;
      try {
        do {
          rerunRequested = false;
          await syncEnvironmentDrafts({
            environmentId,
            remoteDrafts: inputsRef.current.remoteDrafts,
            projects: inputsRef.current.projects,
            groupingSettings: inputsRef.current.groupingSettings,
            upsertDraft: commandsRef.current.upsertDraft,
            discardDraft: commandsRef.current.discardDraft,
            editingDraftId: resolveEditingDraftId(router),
          });
        } while (rerunRequested && !lifecycle.disposed);
      } finally {
        running = false;
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

    const unsubscribe = useComposerDraftStore.subscribe(() => schedule(LOCAL_EDIT_DEBOUNCE_MS));
    schedule(REMOTE_CHANGE_DEBOUNCE_MS);

    return () => {
      lifecycle.disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      unsubscribe();
    };
  }, [environmentId, remoteDrafts, router]);

  return null;
}

function resolveEditingDraftId(router: ReturnType<typeof useRouter>): DraftId | null {
  const params = router.state.matches[router.state.matches.length - 1]?.params ?? {};
  const target = resolveThreadRouteTarget(params);
  return target?.kind === "draft" ? target.draftId : null;
}

async function syncEnvironmentDrafts(input: {
  readonly environmentId: EnvironmentId;
  readonly remoteDrafts: ReadonlyArray<OrchestrationDraft>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly groupingSettings: ProjectGroupingSettings;
  readonly upsertDraft: DraftCommand<UpsertDraftInput>;
  readonly discardDraft: DraftCommand<DiscardDraftInput>;
  readonly editingDraftId: DraftId | null;
}): Promise<void> {
  const store = useComposerDraftStore.getState();
  const synced = loadSyncedDrafts();
  const localDrafts = collectLocalDraftRecords(store);
  const plan = planDraftSync({
    environmentId: input.environmentId,
    localDrafts,
    remoteDrafts: input.remoteDrafts,
    syncedDrafts: synced,
    editingDraftId: input.editingDraftId,
  });

  let bookkeepingChanged = false;

  // A draft that is neither here nor on the server is finished — sent, or
  // discarded — and its bookkeeping would otherwise accumulate forever.
  // Drafts owned by another environment still appear in `localDrafts`, so
  // this only reaps what nothing refers to.
  const liveDraftIds = new Set<string>([
    ...localDrafts.map((record) => record.draftId),
    ...input.remoteDrafts.map((draft) => draft.id),
  ]);
  for (const draftId of synced.keys()) {
    if (!liveDraftIds.has(draftId)) {
      synced.delete(draftId);
      bookkeepingChanged = true;
    }
  }

  for (const draftId of plan.push) {
    const session = store.getDraftSession(draftId);
    if (session === null) {
      continue;
    }
    const content = toDraftWireContent(session, store.getComposerDraft(draftId));
    const editedAt = new Date().toISOString();
    const result = await input.upsertDraft({
      environmentId: input.environmentId,
      input: { ...content, draftId, createdAt: editedAt },
    });
    if (result._tag !== "Success") {
      continue;
    }
    synced.set(draftId, { signature: draftSignature(content), updatedAt: editedAt });
    bookkeepingChanged = true;
  }

  for (const draftId of plan.discard) {
    const result = await input.discardDraft({
      environmentId: input.environmentId,
      input: { draftId },
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
    });
    bookkeepingChanged = true;
  }

  for (const draftId of plan.removeLocal) {
    useComposerDraftStore.getState().clearDraftThread(draftId);
    synced.delete(draftId);
    bookkeepingChanged = true;
  }

  if (bookkeepingChanged) {
    saveSyncedDrafts(synced);
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
