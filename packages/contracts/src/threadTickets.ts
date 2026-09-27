/**
 * Thread ↔ ticket links (Jira, Linear, GitHub/GitLab/Forgejo issues, Azure DevOps work items).
 *
 * Fork-only (docs/jardo/forking-strategy.md). Command and event types carry a `j-` marker
 * because they are persisted in the event store: an upstream event that later picked the same
 * name with a different payload would otherwise fail to decode the fork's history.
 *
 * A ticket link is just a labelled URL. Nothing here talks to a tracker, so links never go stale
 * and need no credentials; the label is derived from the URL where possible
 * (see `@t3tools/shared/threadTickets`).
 */
import * as Schema from "effect/Schema";

import { CommandId, IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Who created a thread ↔ ticket link. */
export const ThreadTicketLinkSource = Schema.Literals(["manual", "agent"]);
export type ThreadTicketLinkSource = typeof ThreadTicketLinkSource.Type;

export const ThreadTicketLink = Schema.Struct({
  /** Canonical ticket URL; the link's identity within a thread. */
  url: TrimmedNonEmptyString,
  /** What the UI shows and search matches, for example `PROJ-123` or `repo#42`. */
  key: TrimmedNonEmptyString,
  source: ThreadTicketLinkSource,
  linkedAt: IsoDateTime,
});
export type ThreadTicketLink = typeof ThreadTicketLink.Type;

export const ThreadTicketLinkCommand = Schema.Struct({
  type: Schema.Literal("thread.j-ticket.link"),
  commandId: CommandId,
  threadId: ThreadId,
  url: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  source: ThreadTicketLinkSource,
});

export const ThreadTicketUnlinkCommand = Schema.Struct({
  type: Schema.Literal("thread.j-ticket.unlink"),
  commandId: CommandId,
  threadId: ThreadId,
  url: TrimmedNonEmptyString,
});

export const ThreadTicketLinkedPayload = Schema.Struct({
  threadId: ThreadId,
  link: ThreadTicketLink,
  updatedAt: IsoDateTime,
});
export type ThreadTicketLinkedPayload = typeof ThreadTicketLinkedPayload.Type;

export const ThreadTicketUnlinkedPayload = Schema.Struct({
  threadId: ThreadId,
  url: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type ThreadTicketUnlinkedPayload = typeof ThreadTicketUnlinkedPayload.Type;
