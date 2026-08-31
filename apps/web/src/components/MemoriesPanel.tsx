/**
 * Memories right-panel surface: what the agent committed to durable memory
 * during this thread, and the only place that record is collected.
 *
 * The list is derived, not stored — see `memoryRuntime`, which recognizes a
 * memory by the path a file tool wrote to. Rows therefore carry a path the
 * agent chose, which may no longer exist by the time you expand it; a failed
 * read renders as a message on the row rather than an empty panel.
 *
 * Content is fetched only when a row is expanded. A thread that saves a dozen
 * memories should cost zero reads until the user asks for one.
 */
import type {
  MemoryFileKind,
  MemoryPanelModel,
  SavedMemory,
} from "@t3tools/client-runtime/state/memoryRuntime";
import { formatMemoryKindLabel } from "@t3tools/client-runtime/state/memoryRuntime";
import type { EnvironmentId } from "@t3tools/contracts";
import { BookMarked, ChevronDown, ChevronRight, FileText, ScrollText } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const KIND_ICONS: Record<MemoryFileKind, typeof FileText> = {
  index: BookMarked,
  entry: FileText,
  instructions: ScrollText,
};

/**
 * Reads one memory file. The memory's own directory is the read root, so a
 * store outside the workspace still resolves while the server's containment
 * check keeps the read to that directory.
 */
function MemoryContents({
  environmentId,
  memory,
}: {
  environmentId: EnvironmentId;
  memory: SavedMemory;
}) {
  const { data, error, isPending } = useProjectFileQuery(
    environmentId,
    memory.directory,
    memory.name,
  );

  if (isPending && !data) {
    return <p className="px-2 py-1.5 text-muted-foreground text-xs">Reading…</p>;
  }
  if (error) {
    return (
      <p className="px-2 py-1.5 text-muted-foreground text-xs">
        Could not read this file. It may have been moved or deleted since it was saved.
      </p>
    );
  }
  if (!data) {
    return null;
  }

  return (
    <div className="px-2 pb-2">
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-[.7rem] leading-relaxed text-muted-foreground">
        {data.contents}
      </pre>
      {data.truncated ? (
        <p className="pt-1 text-[.65rem] text-muted-foreground/70">Preview truncated.</p>
      ) : null}
    </div>
  );
}

function MemoryRow({
  memory,
  environmentId,
}: {
  memory: SavedMemory;
  environmentId: EnvironmentId | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = KIND_ICONS[memory.kind];
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const metadata = [
    formatMemoryKindLabel(memory.kind),
    formatRelativeTimeLabel(memory.savedAt),
    memory.writeCount > 1 ? `${memory.writeCount} writes` : null,
  ].filter((value): value is string => value !== null && value.length > 0);

  return (
    <div className="rounded-md">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className={cn(
          "grid w-full cursor-pointer grid-cols-[0.875rem_0.875rem_minmax(0,1fr)] grid-rows-[1.25rem_1rem] items-center gap-x-2 rounded-md px-1.5 py-1 text-left",
          "hover:bg-accent/60",
        )}
      >
        <Chevron aria-hidden className="col-start-1 row-start-1 size-3.5 text-muted-foreground" />
        <Icon aria-hidden className="col-start-2 row-start-1 size-3.5 text-muted-foreground" />
        <span className="col-start-3 row-start-1 min-w-0 truncate font-medium text-sm">
          {memory.name}
        </span>
        <span className="col-start-3 row-start-2 truncate font-mono text-[.7rem] text-muted-foreground/70">
          {metadata.join(" · ")}
        </span>
      </button>
      {expanded ? (
        <div className="pt-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <p className="truncate px-2 pb-1 font-mono text-[.65rem] text-muted-foreground/60">
                  {memory.path}
                </p>
              }
            />
            <TooltipPopup side="bottom">{memory.path}</TooltipPopup>
          </Tooltip>
          {environmentId ? (
            <MemoryContents environmentId={environmentId} memory={memory} />
          ) : (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">
              Contents are only available while the thread's environment is connected.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function MemoriesPanel({
  model,
  environmentId = null,
}: {
  model: MemoryPanelModel;
  environmentId?: EnvironmentId | null;
}) {
  if (!model.hasMemories) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <BookMarked aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="font-medium text-sm">No memories yet</p>
        <p className="max-w-56 text-muted-foreground text-xs">
          When this thread's agent writes something to its memory store, it shows up here with the
          saved contents.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {model.memories.map((memory) => (
            <MemoryRow key={memory.path} memory={memory} environmentId={environmentId} />
          ))}
        </div>
      </ScrollArea>
      <footer className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 font-mono text-[.7rem] text-muted-foreground">
        <span>{model.newCount} saved this thread</span>
      </footer>
    </div>
  );
}
