import type {
  JThreadTicket,
  OrchestrationV2AppThread,
  OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export type JThreadTicketCommand = Extract<
  OrchestrationV2ServerCommand,
  { readonly type: "thread.j-ticket.link" | "thread.j-ticket.unlink" }
>;

export function jThreadTicketsOf(
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
  const existing = tickets.find((ticket) => ticket.url === command.url);
  if (command.type === "thread.j-ticket.unlink") {
    return existing === undefined
      ? thread
      : { ...thread, jTickets: tickets.filter((ticket) => ticket !== existing), updatedAt: now };
  }
  if (existing !== undefined) {
    // Relinking corrects the shown ID, but an agent never overrides one the user entered.
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
