import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  classifyMemoryPath,
  deriveMemoryPanelModel,
  foldMemoryActivities,
} from "./memoryRuntime.ts";

let sequence = 0;

/** Slimmed `file_change` activity, shaped as it arrives over the wire. */
function fileChange(
  paths: readonly string[],
  options: { at?: string; status?: string; kind?: string } = {},
): OrchestrationThreadActivity {
  sequence += 1;
  return {
    id: `activity-${sequence}`,
    tone: "tool",
    kind: options.kind ?? "tool.completed",
    summary: "File change",
    payload: {
      itemType: "file_change",
      status: options.status ?? "completed",
      data: { files: paths.map((path) => ({ path })) },
    },
    turnId: null,
    createdAt: options.at ?? `2026-08-01T10:00:${String(sequence).padStart(2, "0")}.000Z`,
  } as unknown as OrchestrationThreadActivity;
}

describe("classifyMemoryPath", () => {
  it("recognizes entries and the index under a memory directory", () => {
    expect(classifyMemoryPath("/home/dev/.claude/projects/-repo/memory/prefers-tabs.md")).toBe(
      "entry",
    );
    expect(classifyMemoryPath("/home/dev/.claude/projects/-repo/memory/MEMORY.md")).toBe("index");
  });

  it("is independent of the store root, so a relocated config dir still counts", () => {
    // CLAUDE_CONFIG_DIR, a remote environment's $HOME, and each provider's own
    // root all move the store; only the `memory/` segment is load-bearing.
    expect(classifyMemoryPath("/srv/agents/.claude-work/projects/-x/memory/note.md")).toBe("entry");
    expect(classifyMemoryPath("/home/dev/.codex/memories/api-quirk.md")).toBe("entry");
    expect(classifyMemoryPath("C:\\Users\\dev\\.claude\\memory\\note.md")).toBe("entry");
  });

  it("counts agent-instruction files wherever they sit", () => {
    expect(classifyMemoryPath("/repo/AGENTS.md")).toBe("instructions");
    expect(classifyMemoryPath("/repo/apps/web/CLAUDE.md")).toBe("instructions");
  });

  it("counts Cursor project rules, which are a directory rather than one file", () => {
    expect(classifyMemoryPath("/repo/.cursor/rules/testing.mdc")).toBe("instructions");
    expect(classifyMemoryPath("/repo/.cursorrules")).toBe("instructions");
    // A `rules` directory on its own is ordinary application code.
    expect(classifyMemoryPath("/repo/src/rules/pricing.ts")).toBeNull();
  });

  it("ignores ordinary source and doc writes", () => {
    expect(classifyMemoryPath("/repo/src/index.ts")).toBeNull();
    expect(classifyMemoryPath("/repo/docs/architecture.md")).toBeNull();
    // A file merely named like a memory is not one.
    expect(classifyMemoryPath("/repo/src/memory.ts")).toBeNull();
  });
});

describe("foldMemoryActivities", () => {
  it("collapses repeated writes to one row and keeps both timestamps", () => {
    const index = "/home/dev/.claude/projects/-repo/memory/MEMORY.md";
    const memories = foldMemoryActivities([
      fileChange([index], { at: "2026-08-01T10:00:00.000Z" }),
      fileChange([index], { at: "2026-08-01T10:05:00.000Z" }),
      fileChange([index], { at: "2026-08-01T10:09:00.000Z" }),
    ]);

    expect(memories).toHaveLength(1);
    expect(memories[0]?.writeCount).toBe(3);
    expect(memories[0]?.firstSavedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(memories[0]?.savedAt).toBe("2026-08-01T10:09:00.000Z");
  });

  it("orders newest first and splits name from read root", () => {
    const memories = foldMemoryActivities([
      fileChange(["/home/dev/.claude/projects/-repo/memory/older.md"], {
        at: "2026-08-01T10:00:00.000Z",
      }),
      fileChange(["/home/dev/.claude/projects/-repo/memory/newer.md"], {
        at: "2026-08-01T10:30:00.000Z",
      }),
    ]);

    expect(memories.map((memory) => memory.name)).toEqual(["newer.md", "older.md"]);
    expect(memories[0]?.directory).toBe("/home/dev/.claude/projects/-repo/memory");
  });

  it("ignores non-terminal, declined, and non-file activities", () => {
    const path = "/home/dev/.claude/projects/-repo/memory/note.md";
    expect(foldMemoryActivities([fileChange([path], { kind: "tool.started" })])).toEqual([]);
    expect(foldMemoryActivities([fileChange([path], { kind: "tool.updated" })])).toEqual([]);
    expect(foldMemoryActivities([fileChange([path], { status: "declined" })])).toEqual([]);
    expect(foldMemoryActivities([fileChange([path], { status: "failed" })])).toEqual([]);
  });

  it("keeps only the memory paths out of a mixed write", () => {
    const memories = foldMemoryActivities([
      fileChange([
        "/repo/src/index.ts",
        "/home/dev/.claude/projects/-repo/memory/note.md",
        "/repo/README.md",
      ]),
    ]);
    expect(memories.map((memory) => memory.name)).toEqual(["note.md"]);
  });

  it("does not move savedAt backwards when a replay arrives out of order", () => {
    const path = "/home/dev/.claude/projects/-repo/memory/note.md";
    const memories = foldMemoryActivities([
      fileChange([path], { at: "2026-08-01T10:30:00.000Z" }),
      fileChange([path], { at: "2026-08-01T10:00:00.000Z" }),
    ]);
    expect(memories[0]?.savedAt).toBe("2026-08-01T10:30:00.000Z");
    expect(memories[0]?.firstSavedAt).toBe("2026-08-01T10:00:00.000Z");
  });
});

describe("deriveMemoryPanelModel", () => {
  it("badges the count of distinct memory files, not writes", () => {
    const index = "/home/dev/.claude/projects/-repo/memory/MEMORY.md";
    const model = deriveMemoryPanelModel(
      foldMemoryActivities([
        fileChange([index]),
        fileChange(["/home/dev/.claude/projects/-repo/memory/one.md"]),
        fileChange([index]),
      ]),
    );
    expect(model.newCount).toBe(2);
    expect(model.hasMemories).toBe(true);
  });

  it("is empty for a thread that saved nothing", () => {
    const model = deriveMemoryPanelModel(foldMemoryActivities([fileChange(["/repo/src/a.ts"])]));
    expect(model.newCount).toBe(0);
    expect(model.hasMemories).toBe(false);
  });
});
