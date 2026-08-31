/**
 * Memory observability: a fold over persisted file-change thread activities
 * into the set of agent memory files this thread wrote, plus the panel model
 * the Memories surface renders.
 *
 * There is no memory concept in the orchestration protocol — no provider
 * announces "I saved a memory". What every provider does do is write the
 * memory to disk through an ordinary file tool, so this module recognizes
 * memories by where they land (see `classifyMemoryPath`). That keeps the
 * feature provider-neutral and costs nothing on the wire: it reads the same
 * `tool.*` activities the work log already receives.
 *
 * Detection depends on the changed-file list surviving payload slimming.
 * Claude spells its tool input `file_path`, which the server projection
 * learned to collect alongside `path`/`filePath`; without that a Claude
 * memory write reaches the client with no path at all.
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

/**
 * What kind of memory file a path is, which is also how the panel groups
 * rows. `index` is the table of contents an agent rewrites on nearly every
 * save; `entry` is one durable fact; `instructions` is a committed
 * agent-instruction file that doubles as long-term memory.
 */
export type MemoryFileKind = "index" | "entry" | "instructions";

export interface SavedMemory {
  /** Activity id of the most recent write, stable across re-renders. */
  readonly id: string;
  /** Absolute path exactly as the agent wrote it. */
  readonly path: string;
  /** Basename, the panel's row title. */
  readonly name: string;
  /** Parent directory; the read RPC uses it as the read root. */
  readonly directory: string;
  readonly kind: MemoryFileKind;
  /** ISO timestamp of the first write in this thread. */
  readonly firstSavedAt: string;
  /** ISO timestamp of the most recent write in this thread. */
  readonly savedAt: string;
  /** How many times this thread wrote the file. */
  readonly writeCount: number;
}

export interface MemoryPanelModel {
  /** Most recently written first. */
  readonly memories: ReadonlyArray<SavedMemory>;
  /** Distinct memory files written in this thread; drives the panel badge. */
  readonly newCount: number;
  readonly hasMemories: boolean;
}

export const EMPTY_MEMORY_PANEL_MODEL: MemoryPanelModel = {
  memories: [],
  newCount: 0,
  hasMemories: false,
};

/**
 * Agent-instruction files that hold durable knowledge wherever they sit.
 * Matched on basename only, so a repo's own `AGENTS.md` counts.
 */
const INSTRUCTION_FILENAMES = new Set(["agents.md", "claude.md", ".cursorrules"]);

/** Directory segment every file-based memory store nests its entries under. */
const MEMORY_DIRECTORY_SEGMENTS = new Set(["memory", "memories"]);

/** The index an agent keeps beside its entries. */
const MEMORY_INDEX_FILENAMES = new Set(["memory.md", "index.md", "readme.md"]);

function segmentsOf(path: string): string[] {
  return path.split(/[/\\]/u).filter((segment) => segment.length > 0);
}

/**
 * Decides whether a written path is agent memory, and which kind.
 *
 * A file is memory when it sits under a directory segment named `memory` or
 * `memories`, or when its basename is a known agent-instruction file. Both
 * rules are deliberately shape-based rather than rooted at a fixed home
 * directory: `CLAUDE_CONFIG_DIR` moves the store, remote environments have a
 * different `$HOME`, and each provider picks its own root.
 */
export function classifyMemoryPath(path: string): MemoryFileKind | null {
  const segments = segmentsOf(path);
  const name = segments.at(-1);
  if (name === undefined) {
    return null;
  }
  const lowerName = name.toLowerCase();

  if (
    segments.slice(0, -1).some((segment) => MEMORY_DIRECTORY_SEGMENTS.has(segment.toLowerCase()))
  ) {
    return MEMORY_INDEX_FILENAMES.has(lowerName) ? "index" : "entry";
  }
  if (INSTRUCTION_FILENAMES.has(lowerName)) {
    return "instructions";
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Paths from a slimmed file-change payload. The server normalizes every
 * provider's spelling into `data.files: [{ path }]`, so this stays a shallow
 * read rather than a second recursive walk.
 */
function writtenPathsOf(activity: OrchestrationThreadActivity): string[] {
  const payload = asRecord(activity.payload);
  if (payload?.itemType !== "file_change") {
    return [];
  }
  // A declined or failed write never reached disk, so it is not a memory.
  if (payload.status !== undefined && payload.status !== "completed") {
    return [];
  }
  const files = asRecord(payload.data)?.files;
  if (!Array.isArray(files)) {
    return [];
  }
  const paths: string[] = [];
  for (const entry of files) {
    const path = asRecord(entry)?.path;
    if (typeof path === "string" && path.trim().length > 0) {
      paths.push(path.trim());
    }
  }
  return paths;
}

function directoryOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : path;
}

function nameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/**
 * Folds file-change activities into one row per memory file.
 *
 * Repeated writes to the same path collapse: an agent rewrites its index on
 * every save, and six identical `MEMORY.md` rows would bury the entries that
 * actually changed. The row keeps both timestamps and the write count so the
 * panel can still say the file was touched more than once.
 */
export function foldMemoryActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<SavedMemory> {
  const byPath = new Map<string, SavedMemory>();

  for (const activity of activities) {
    if (activity.kind !== "tool.completed") {
      continue;
    }
    for (const path of writtenPathsOf(activity)) {
      const kind = classifyMemoryPath(path);
      if (kind === null) {
        continue;
      }
      const existing = byPath.get(path);
      if (existing) {
        // Activities arrive in order, but a late-arriving replay must not
        // move `savedAt` backwards.
        const isNewer = activity.createdAt >= existing.savedAt;
        byPath.set(path, {
          ...existing,
          id: isNewer ? activity.id : existing.id,
          savedAt: isNewer ? activity.createdAt : existing.savedAt,
          firstSavedAt:
            activity.createdAt < existing.firstSavedAt ? activity.createdAt : existing.firstSavedAt,
          writeCount: existing.writeCount + 1,
        });
        continue;
      }
      byPath.set(path, {
        id: activity.id,
        path,
        name: nameOf(path),
        directory: directoryOf(path),
        kind,
        firstSavedAt: activity.createdAt,
        savedAt: activity.createdAt,
        writeCount: 1,
      });
    }
  }

  return [...byPath.values()].sort(
    (left, right) =>
      right.savedAt.localeCompare(left.savedAt) || left.path.localeCompare(right.path),
  );
}

export function deriveMemoryPanelModel(memories: ReadonlyArray<SavedMemory>): MemoryPanelModel {
  if (memories.length === 0) {
    return EMPTY_MEMORY_PANEL_MODEL;
  }
  return { memories, newCount: memories.length, hasMemories: true };
}

const MEMORY_KIND_LABELS: Record<MemoryFileKind, string> = {
  index: "Index",
  entry: "Memory",
  instructions: "Instructions",
};

export function formatMemoryKindLabel(kind: MemoryFileKind): string {
  return MEMORY_KIND_LABELS[kind];
}
