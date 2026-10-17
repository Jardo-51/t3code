import type { ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { parseTicketUrl, ticketKeyFromUrl } from "@t3tools/shared/jThreadTickets";
import { Atom } from "effect/reactivity";
import { XIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useThreadShell } from "~/state/entities";
import {
  useJThreadTicketMutations,
  useJThreadTicketsSupported,
  useOpenTicketLink,
} from "./useJThreadTickets";

/** Rendered once by the chat view so the dialog outlives the palette or menu that opened it. */
const ticketsDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("tickets:dialog-thread"),
);

export function openJThreadTicketsDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(ticketsDialogThreadAtom, threadRef);
}

export function JThreadTicketsDialogHost() {
  const threadRef = useAtomValue(ticketsDialogThreadAtom);
  const supported = useJThreadTicketsSupported(threadRef?.environmentId);
  if (threadRef === null || !supported) return null;
  return (
    <JThreadTicketsDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
      onClose={() => appAtomRegistry.set(ticketsDialogThreadAtom, null)}
    />
  );
}

function errorMessage(result: Parameters<typeof squashAtomCommandFailure>[0], fallback: string) {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : fallback;
}

function JThreadTicketsDialog({
  threadRef,
  onClose,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onClose: () => void;
}) {
  const tickets = useThreadShell(threadRef)?.jTickets ?? [];
  const mutations = useJThreadTicketMutations();
  const openTicket = useOpenTicketLink(threadRef);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => urlInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const url = parseTicketUrl(urlInput);
  const parsedKey = url === null ? null : ticketKeyFromUrl(url);
  const key = keyInput.trim() || parsedKey;
  const validation = !dirty
    ? null
    : url === null
      ? "Paste the ticket's http(s) URL."
      : key === null
        ? "Enter the ticket ID; it cannot be read from this URL."
        : null;

  const submit = async () => {
    setDirty(true);
    if (url === null || key === null) return;
    setError(null);
    setPending(true);
    const result = await settlePromise(() => mutations.link(threadRef, url, key));
    setPending(false);
    if (result._tag === "Failure") {
      setError(errorMessage(result, "Could not link the ticket."));
      return;
    }
    if (tickets.length > 0) {
      setUrlInput("");
      setKeyInput("");
      setDirty(false);
    } else {
      onClose();
    }
  };

  const unlink = async (ticketUrl: string) => {
    setError(null);
    setPending(true);
    const result = await settlePromise(() => mutations.unlink(threadRef, ticketUrl));
    setPending(false);
    if (result._tag === "Failure") setError(errorMessage(result, "Could not unlink the ticket."));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submit();
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{tickets.length > 0 ? "Thread tickets" : "Link ticket"}</DialogTitle>
          <DialogDescription>
            Link an issue-tracker ticket by its URL. T3 Code never contacts the tracker.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {tickets.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {tickets.map((ticket) => (
                <li key={ticket.url} className="flex min-w-0 items-center gap-2">
                  <a
                    href={ticket.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => openTicket(event, ticket.url)}
                    className="shrink-0 font-medium text-sm hover:underline"
                  >
                    {ticket.key}
                  </a>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                    {ticket.url}
                  </span>
                  <Button
                    type="button"
                    variant="ghost-destructive"
                    size="icon-xs"
                    aria-label={`Unlink ${ticket.key}`}
                    disabled={pending}
                    onClick={() => void unlink(ticket.url)}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <Input
            ref={urlInputRef}
            placeholder="https://acme.atlassian.net/browse/PROJ-123"
            aria-label="Ticket URL"
            value={urlInput}
            onChange={(event) => {
              setDirty(true);
              setUrlInput(event.target.value);
            }}
            onKeyDown={onKeyDown}
          />
          {url !== null && parsedKey === null ? (
            <Input
              placeholder="Ticket ID, such as PROJ-123"
              aria-label="Ticket ID"
              value={keyInput}
              onChange={(event) => setKeyInput(event.target.value)}
              onKeyDown={onKeyDown}
            />
          ) : null}
          {parsedKey !== null ? (
            <p className="truncate text-muted-foreground text-xs">{parsedKey}</p>
          ) : null}
          {(validation ?? error) ? (
            <p className="text-destructive text-xs">{validation ?? error}</p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
            {tickets.length > 0 ? "Done" : "Cancel"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={pending || url === null || key === null}
          >
            {pending ? "Saving..." : "Link"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
