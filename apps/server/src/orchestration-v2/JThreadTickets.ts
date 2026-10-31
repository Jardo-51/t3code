import type {
  JThreadTicket,
  OrchestrationV2AppThread,
  OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import { ticketIdentity } from "@t3tools/shared/jThreadTickets";
import * as DateTime from "effect/DateTime";

export type JThreadTicketCommand = Extract<
  OrchestrationV2ServerCommand,
  { readonly type: "thread.j-ticket.link" | "thread.j-ticket.unlink" }
>;

function jThreadTicketsOf(
  thread: Pick<OrchestrationV2AppThread, "jTickets">,
): ReadonlyArray<JThreadTicket> {
  return thread.jTickets ?? [];
}

/**
 * Tickets ride on the thread payload like pull request links, so every thread event keeps them.
 * Returns `thread` itself when nothing changes.
 */
export function applyJThreadTicketCommand(
  thread: OrchestrationV2AppThread,
  command: JThreadTicketCommand,
  now: DateTime.Utc,
): OrchestrationV2AppThread {
  const tickets = jThreadTicketsOf(thread);
  const identity = ticketIdentity(command.url);
  const isSameTicket = (ticket: JThreadTicket) => ticketIdentity(ticket.url) === identity;
  const existing = tickets.find(isSameTicket);
  if (command.type === "thread.j-ticket.unlink") {
    return existing === undefined
      ? thread
      : {
          ...thread,
          jTickets: tickets.filter((ticket) => !isSameTicket(ticket)),
          updatedAt: now,
        };
  }
  if (existing !== undefined) {
    // The first URL stays. Relinking corrects the shown ID, but an agent never overrides one the
    // user entered.
    if (
      existing.key === command.key ||
      (existing.source === "manual" && command.source === "agent")
    ) {
      return thread;
    }
    return {
      ...thread,
      jTickets: tickets.map((ticket) =>
        ticket === existing ? { ...ticket, key: command.key, source: command.source } : ticket,
      ),
      updatedAt: now,
    };
  }
  return {
    ...thread,
    jTickets: [
      ...tickets,
      {
        url: command.url,
        key: command.key,
        source: command.source,
        linkedAt: DateTime.formatIso(now),
      },
    ],
    updatedAt: now,
  };
}
