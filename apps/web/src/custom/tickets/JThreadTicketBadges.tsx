import type { EnvironmentId, JThreadTicket, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { TicketIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { ComposerControl } from "~/components/chat/ComposerControl";
import { InlineButton } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useClientSettings } from "~/hooks/useSettings";
import { openJThreadTicketsDialog } from "./JThreadTicketsDialog";
import { useOpenTicketLink } from "./useJThreadTickets";

const stopPointer = (event: MouseEvent<HTMLElement>) => event.stopPropagation();

/** Beside the branch under the composer. A right-click opens the thread's ticket list. */
export function JComposerTicketBadges({
  threadRef,
  tickets,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly tickets: ReadonlyArray<JThreadTicket> | undefined;
}) {
  const openTicket = useOpenTicketLink(threadRef);
  if (tickets === undefined || tickets.length === 0) return null;
  return tickets.map((ticket) => (
    <Tooltip key={ticket.url}>
      <TooltipTrigger
        render={
          <ComposerControl
            size="xs"
            render={<a href={ticket.url} target="_blank" rel="noopener noreferrer" />}
            aria-label={`Ticket ${ticket.key}`}
            onPointerDown={stopPointer}
            onClick={(event: MouseEvent<HTMLElement>) => openTicket(event, ticket.url)}
            onContextMenu={(event: MouseEvent<HTMLElement>) => {
              event.preventDefault();
              event.stopPropagation();
              openJThreadTicketsDialog(threadRef);
            }}
          />
        }
      >
        <TicketIcon aria-hidden className="size-3 shrink-0 opacity-70" />
        <span className="max-w-32 truncate">{ticket.key}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{ticket.url}</TooltipPopup>
    </Tooltip>
  ));
}

interface SidebarThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly jTickets?: ReadonlyArray<JThreadTicket> | undefined;
}

/** A sidebar row's link badges, each of which the user can hide when the row is too narrow. */
export function JSidebarThreadBadges({
  thread,
  prBadge,
}: {
  readonly thread: SidebarThread;
  readonly prBadge: ReactNode;
}) {
  const showPullRequests = useClientSettings((settings) => settings.jSidebarShowPullRequests);
  return (
    <>
      {showPullRequests ? prBadge : null}
      <JSidebarTicketBadge thread={thread} />
    </>
  );
}

/** Whether `JSidebarThreadBadges` renders anything, so a row can drop an otherwise empty line. */
export function useJSidebarThreadHasBadges(thread: SidebarThread, hasPrBadge: boolean): boolean {
  const showPullRequests = useClientSettings((settings) => settings.jSidebarShowPullRequests);
  const showTickets = useClientSettings((settings) => settings.jSidebarShowTickets);
  return (showPullRequests && hasPrBadge) || (showTickets && (thread.jTickets?.length ?? 0) > 0);
}

function JSidebarTicketBadge({ thread }: { readonly thread: SidebarThread }) {
  const showTickets = useClientSettings((settings) => settings.jSidebarShowTickets);
  const tickets = thread.jTickets ?? [];
  if (!showTickets || tickets.length === 0) return null;
  return <TicketBadge thread={thread} tickets={tickets} />;
}

/** The first ticket with a count of the others. */
function TicketBadge({
  thread,
  tickets,
}: {
  readonly thread: SidebarThread;
  readonly tickets: ReadonlyArray<JThreadTicket>;
}) {
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const openTicket = useOpenTicketLink(threadRef);
  const first = tickets[0]!;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InlineButton
            render={<a href={first.url} target="_blank" rel="noopener noreferrer" />}
            aria-label={`Ticket ${first.key}`}
            onPointerDown={stopPointer}
            onClick={(event: MouseEvent<HTMLElement>) => openTicket(event, first.url)}
          />
        }
      >
        <span className="contents font-normal text-muted-foreground text-xs">
          <TicketIcon aria-hidden className="size-3 shrink-0" />
          <span className="max-w-24 truncate">{first.key}</span>
          {tickets.length > 1 ? <span>+{tickets.length - 1}</span> : null}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">{tickets.map((ticket) => ticket.key).join(", ")}</TooltipPopup>
    </Tooltip>
  );
}
