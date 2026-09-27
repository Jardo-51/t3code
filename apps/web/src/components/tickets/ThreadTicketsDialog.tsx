import type { ScopedThreadRef } from "@t3tools/contracts";
import { canonicalTicketUrl, resolveTicketReference } from "@t3tools/shared/threadTickets";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { TicketIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useThreadShell } from "~/state/entities";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { useSupportsThreadTickets, useThreadTicketLinking } from "./useThreadTickets";

/**
 * Which thread has the tickets dialog open. Set by the command palette and rendered once by the
 * chat view, so the dialog outlives a palette that closes the moment its command runs.
 */
const threadTicketsDialogAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("tickets:dialog-thread"),
);

export function openThreadTicketsDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(threadTicketsDialogAtom, threadRef);
}

/** Mounted once per chat view; shows the dialog for whichever thread asked for it. */
export function ThreadTicketsDialogHost() {
  const threadRef = useAtomValue(threadTicketsDialogAtom);
  const supported = useSupportsThreadTickets(threadRef?.environmentId);
  if (threadRef === null || !supported) return null;
  return (
    <ThreadTicketsDialog
      threadRef={threadRef}
      onClose={() => appAtomRegistry.set(threadTicketsDialogAtom, null)}
    />
  );
}

/** Lists the thread's tickets with a way to unlink each, and links new ones by URL. */
function ThreadTicketsDialog({
  threadRef,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tickets = useThreadShell(threadRef)?.tickets ?? [];
  const linking = useThreadTicketLinking();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const trimmedUrl = url.trim();
  const isUrl = canonicalTicketUrl(trimmedUrl) !== null;
  const needsKey = isUrl && resolveTicketReference({ url: trimmedUrl }) === null;
  const ticket = resolveTicketReference({ url: trimmedUrl, key });
  const alreadyLinked = ticket !== null && tickets.some((entry) => entry.url === ticket.url);
  const validation = !dirty
    ? null
    : trimmedUrl.length === 0
      ? "Paste the ticket's URL."
      : !isUrl
        ? "Use the ticket's full http(s) URL."
        : needsKey && key.trim().length === 0
          ? "This tracker is not recognised. Enter the ticket's ID."
          : alreadyLinked
            ? `${ticket?.key} is already linked.`
            : null;

  const run = useCallback(async (action: () => Promise<void>, fallback: string) => {
    setError(null);
    setPending(true);
    try {
      await action();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const submit = async () => {
    setDirty(true);
    if (ticket === null || alreadyLinked) return;
    if (await run(() => linking.link(threadRef, ticket), "Could not link the ticket.")) {
      setUrl("");
      setKey("");
      setDirty(false);
    }
  };

  const onEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submit();
  };

  return (
    <Dialog open onOpenChange={(next) => (pending || next ? undefined : onClose())}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Tickets</DialogTitle>
          <DialogDescription>
            Link the tickets this thread works on. Paste a Jira, Linear, GitHub, GitLab, Forgejo or
            Azure DevOps ticket URL; other trackers work too if you enter the ticket&apos;s ID.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {tickets.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {tickets.map((entry) => (
                <li key={entry.url} className="flex min-w-0 items-center gap-2 text-sm">
                  <TicketIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 font-medium">{entry.key}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                    {entry.url}
                  </span>
                  <Button
                    type="button"
                    variant="ghost-destructive"
                    size="icon-xs"
                    aria-label={`Unlink ${entry.key}`}
                    disabled={pending}
                    onClick={() =>
                      void run(
                        () => linking.unlink(threadRef, entry.url),
                        "Could not unlink the ticket.",
                      )
                    }
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <Input
            ref={inputRef}
            placeholder="https://your-company.atlassian.net/browse/PROJ-123"
            value={url}
            onChange={(event) => {
              setDirty(true);
              setUrl(event.target.value);
            }}
            onKeyDown={onEnter}
          />
          {needsKey ? (
            <Input
              placeholder="Ticket ID, for example PROJ-123"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={onEnter}
            />
          ) : null}
          {ticket !== null && !alreadyLinked && validation === null ? (
            <p className="truncate text-muted-foreground text-xs">Links {ticket.key}</p>
          ) : null}
          {(validation ?? error) ? (
            <p className="text-destructive text-xs">{validation ?? error}</p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Close
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={pending || ticket === null || alreadyLinked}
          >
            {pending ? "Saving..." : "Link"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
