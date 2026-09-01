import * as Arr from "effect/Array";
import type { OrchestrationShellSnapshot, OrchestrationShellStreamEvent } from "@t3tools/contracts";

/**
 * Reduce a single shell stream event into an existing snapshot, returning a new
 * snapshot with the event's changes applied. This is a pure reducer that both
 * web and mobile can use to keep their local shell snapshot in sync.
 *
 * Returns the original snapshot reference unchanged if the event is not
 * recognized (forward-compatible).
 */
export function applyShellStreamEvent(
  snapshot: OrchestrationShellSnapshot,
  event: OrchestrationShellStreamEvent,
): OrchestrationShellSnapshot {
  if (event.sequence <= snapshot.snapshotSequence) return snapshot;

  switch (event.kind) {
    case "project-upserted": {
      const projects = snapshot.projects.some((p) => p.id === event.project.id)
        ? Arr.map(snapshot.projects, (p) => (p.id === event.project.id ? event.project : p))
        : Arr.append(snapshot.projects, event.project);
      return { ...snapshot, projects, snapshotSequence: event.sequence };
    }
    case "project-removed":
      return {
        ...snapshot,
        projects: Arr.filter(snapshot.projects, (p) => p.id !== event.projectId),
        // Deleting a project retires its drafts server-side without a
        // `draft-removed` each. Dropping them here rather than fanning out one
        // event per draft keeps a project with many drafts from paying for its
        // own deletion in stream traffic.
        drafts: Arr.filter(snapshot.drafts, (d) => d.projectId !== event.projectId),
        snapshotSequence: event.sequence,
      };
    case "thread-upserted": {
      const threads = snapshot.threads.some((t) => t.id === event.thread.id)
        ? Arr.map(snapshot.threads, (t) => (t.id === event.thread.id ? event.thread : t))
        : Arr.append(snapshot.threads, event.thread);
      return { ...snapshot, threads, snapshotSequence: event.sequence };
    }
    case "thread-removed":
      return {
        ...snapshot,
        threads: Arr.filter(snapshot.threads, (t) => t.id !== event.threadId),
        snapshotSequence: event.sequence,
      };
    case "draft-upserted": {
      const drafts = snapshot.drafts.some((d) => d.id === event.draft.id)
        ? Arr.map(snapshot.drafts, (d) => (d.id === event.draft.id ? event.draft : d))
        : Arr.append(snapshot.drafts, event.draft);
      return { ...snapshot, drafts, snapshotSequence: event.sequence };
    }
    case "draft-removed":
      return {
        ...snapshot,
        drafts: Arr.filter(snapshot.drafts, (d) => d.id !== event.draftId),
        snapshotSequence: event.sequence,
      };
    default:
      return snapshot;
  }
}
