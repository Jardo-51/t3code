import type {
  EnvironmentId,
  ExecutionEnvironmentCapabilities,
  JThreadTicket,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { msg } from "gt-react";
import { TicketIcon } from "lucide-react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "~/components/CommandPalette.logic";
import { m, type MessageResolver } from "~/i18n/messages";
import { openJThreadTicketsDialog } from "./JThreadTicketsDialog";
import { supportsJThreadTickets } from "./useJThreadTickets";

export function jThreadTicketsPaletteAction(
  thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly jTickets?: ReadonlyArray<JThreadTicket> | undefined;
  } | null,
  capabilities: ExecutionEnvironmentCapabilities | undefined,
  resolve: MessageResolver = m,
): CommandPaletteActionItem | null {
  if (thread === null || !supportsJThreadTickets(capabilities)) return null;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  return {
    kind: "action",
    value: "action:j-thread-tickets",
    searchTerms: ["link", "ticket", "tickets", "issue", "jira", "linear", "unlink"],
    title: resolve(
      (thread.jTickets ?? []).length > 0
        ? msg("Manage thread tickets")
        : msg("Link ticket to thread"),
    ),
    icon: <TicketIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      openJThreadTicketsDialog(threadRef);
    },
  };
}
