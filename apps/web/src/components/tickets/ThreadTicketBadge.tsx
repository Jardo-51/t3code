import type { ScopedThreadRef, ThreadTicketLink } from "@t3tools/contracts";
import { useRender } from "@base-ui/react/use-render";
import { TicketIcon } from "lucide-react";
import type { MouseEvent, ReactElement, ReactNode } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { useClientSettings } from "~/hooks/useSettings";
import { ComposerControl } from "../chat/ComposerControl";
import { InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { openThreadTicketsDialog } from "./ThreadTicketsDialog";

const NO_TICKETS: ReadonlyArray<ThreadTicketLink> = [];

/**
 * A linked ticket shown as its key. The caller owns the control it sits in through `render` (an
 * inline link in a sidebar row, a toolbar control in the composer); the badge makes it a link
 * that opens the ticket where the "Open links in" setting says. A plain modifier click is left to
 * the anchor so it still opens the system browser. With `manageOnContextMenu`, a right-click
 * opens the thread's tickets dialog instead of the link menu.
 */
export function ThreadTicketBadge({
  render,
  ticket,
  threadRef,
  others = NO_TICKETS,
  manageOnContextMenu = false,
}: {
  render: ReactElement<{ render?: useRender.RenderProp }>;
  ticket: ThreadTicketLink;
  threadRef: ScopedThreadRef;
  /** Further tickets on the thread that this badge stands in for, named in its tooltip. */
  others?: ReadonlyArray<ThreadTicketLink>;
  /** Only where the tickets dialog is mounted, which is the chat view. */
  manageOnContextMenu?: boolean;
}) {
  const openLink = useOpenLink(threadRef);
  const control = useRender({
    render,
    props: {
      render: <a href={ticket.url} target="_blank" rel="noopener noreferrer" />,
      "aria-label": `Open ticket ${ticket.key}`,
      onPointerDown: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
      ...(manageOnContextMenu
        ? {
            onContextMenu: (event: MouseEvent<HTMLElement>) => {
              event.preventDefault();
              openThreadTicketsDialog(threadRef);
            },
          }
        : {}),
      onClick: (event: MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        if (event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        void openLink(ticket.url, { event, threadRef }).catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Unable to open ticket link",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        });
      },
    },
  });
  return (
    <Tooltip>
      <TooltipTrigger render={control}>
        <span className="contents font-normal text-xs tabular-nums">
          <TicketIcon aria-hidden className="size-3 shrink-0" />
          {ticket.key}
          {others.length > 0 ? (
            <span className="text-muted-foreground">+{others.length}</span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {others.length === 0
          ? ticket.url
          : [ticket, ...others].map((entry) => entry.key).join(", ")}
        {manageOnContextMenu ? (
          <span className="block text-muted-foreground">Right-click to manage tickets</span>
        ) : null}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Every ticket on the thread, each as a composer toolbar control beside the pull request. */
export function ComposerThreadTickets({
  threadRef,
  tickets,
}: {
  threadRef: ScopedThreadRef;
  tickets: ReadonlyArray<ThreadTicketLink> | undefined;
}) {
  return (tickets ?? []).map((ticket) => (
    <ThreadTicketBadge
      key={ticket.url}
      render={<ComposerControl size="xs" />}
      ticket={ticket}
      threadRef={threadRef}
      manageOnContextMenu
    />
  ));
}

/**
 * A sidebar row's link badges: the pull request badge and the first ticket, each shown unless
 * turned off in Settings → General. A row has little room, so further tickets fold into a count.
 */
export function SidebarThreadLinkBadges({
  pullRequestBadge,
  tickets,
  threadRef,
}: {
  pullRequestBadge: ReactNode;
  tickets: ReadonlyArray<ThreadTicketLink> | undefined;
  threadRef: ScopedThreadRef;
}) {
  const showPullRequests = useClientSettings((settings) => settings.jSidebarShowPullRequests);
  const showTickets = useClientSettings((settings) => settings.jSidebarShowTickets);
  const [first, ...others] = tickets ?? [];
  return (
    <>
      {showPullRequests ? pullRequestBadge : null}
      {showTickets && first !== undefined ? (
        <ThreadTicketBadge
          render={<InlineButton />}
          ticket={first}
          threadRef={threadRef}
          others={others}
        />
      ) : null}
    </>
  );
}
