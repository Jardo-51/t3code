import * as Schema from "effect/Schema";

import { CommandId, IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Fork-only: issue-tracker tickets linked to a thread. Names carry the `j` marker because thread
 * payloads and commands are stored and replayed (see docs/jardo/forking-strategy.md).
 */
export const JThreadTicketSource = Schema.Literals(["agent", "manual"]);
export type JThreadTicketSource = typeof JThreadTicketSource.Type;

/**
 * A ticket is identified by its URL, read through `ticketIdentity` in `@t3tools/shared` so other
 * URLs of the same ticket match it; `key` is the ID shown for it, such as PROJ-123.
 */
export const JThreadTicket = Schema.Struct({
  url: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  source: JThreadTicketSource,
  linkedAt: IsoDateTime,
});
export type JThreadTicket = typeof JThreadTicket.Type;

// `TrimmedString` checks the untrimmed value on `make` and encode, so trim before parsing.
const isWebUrl = Schema.makeFilter(
  (value: string) => {
    try {
      const { protocol } = new URL(value.trim());
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  },
  { expected: "an http(s) URL" },
);

/**
 * Every client renders a ticket URL as a link and opens it, so new links must be web addresses.
 * Stored tickets (`JThreadTicket`) keep the plain strings: tightening those would make threads
 * holding an older link undecodable. Both ride on every later event of the thread, hence the caps.
 */
export const JThreadTicketUrl = TrimmedNonEmptyString.check(Schema.isMaxLength(2048), isWebUrl);
export const JThreadTicketKey = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

export const JThreadTicketLinkCommand = Schema.Struct({
  type: Schema.Literal("thread.j-ticket.link"),
  commandId: CommandId,
  threadId: ThreadId,
  url: JThreadTicketUrl,
  key: JThreadTicketKey,
  source: JThreadTicketSource,
});

export const JThreadTicketUnlinkCommand = Schema.Struct({
  type: Schema.Literal("thread.j-ticket.unlink"),
  commandId: CommandId,
  threadId: ThreadId,
  url: TrimmedNonEmptyString,
});
