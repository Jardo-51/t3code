import * as Schema from "effect/Schema";

import { CommandId, IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Fork-only: issue-tracker tickets linked to a thread. Names carry the `j` marker because thread
 * payloads and commands are stored and replayed (see docs/jardo/forking-strategy.md).
 */
export const JThreadTicketSource = Schema.Literals(["agent", "manual"]);
export type JThreadTicketSource = typeof JThreadTicketSource.Type;

/** A ticket is identified by its URL; `key` is the ID shown for it, such as PROJ-123. */
export const JThreadTicket = Schema.Struct({
  url: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  source: JThreadTicketSource,
  linkedAt: IsoDateTime,
});
export type JThreadTicket = typeof JThreadTicket.Type;

export const JThreadTicketLinkCommand = Schema.Struct({
  type: Schema.Literal("thread.j-ticket.link"),
  commandId: CommandId,
  threadId: ThreadId,
  url: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  source: JThreadTicketSource,
});

export const JThreadTicketUnlinkCommand = Schema.Struct({
  type: Schema.Literal("thread.j-ticket.unlink"),
  commandId: CommandId,
  threadId: ThreadId,
  url: TrimmedNonEmptyString,
});
