import { type JThreadTicket, JThreadTicketUrl } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeTicketUrl = Schema.decodeUnknownOption(JThreadTicketUrl);

/** The trimmed input when the server accepts it as a ticket URL; links never contact the tracker. */
export function parseTicketUrl(input: string): string | null {
  return Option.getOrNull(decodeTicketUrl(input));
}

const AZURE_WORK_ITEM = /\/_workitems\/edit\/(\d+)(?:\/|$)/u;
// GitHub, Forgejo, Gitea and Bitbucket use `/<repo>/issues/<n>`; GitLab adds `/-/`.
const NUMBERED_ISSUE = /^\/(?:[^/]+\/)*?([^/]+)\/(?:-\/)?(?:issues|work_items)\/(\d+)(?:\/|$)/u;
// Jira, Linear, YouTrack and similar trackers put a PROJ-123 style ID in the URL.
const PROJECT_KEY = /(?<![A-Za-z0-9])([A-Z][A-Z0-9_]+-[1-9]\d*)(?!\d)/u;

/** The ID a tracker shows for a ticket, read from its URL, or null when the URL has none. */
export function ticketKeyFromUrl(input: string): string | null {
  const href = parseTicketUrl(input);
  if (href === null) return null;
  const url = new URL(href);
  const path = safeDecode(url.pathname);
  const azure = AZURE_WORK_ITEM.exec(path);
  if (azure) return `AB#${azure[1]}`;
  const issue = NUMBERED_ISSUE.exec(path);
  if (issue) return `${issue[1]}#${issue[2]}`;
  const key = PROJECT_KEY.exec(path) ?? PROJECT_KEY.exec(safeDecode(`${url.search}${url.hash}`));
  return key?.[1] ?? null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function jThreadTicketSearchTerms(thread: {
  readonly jTickets?: ReadonlyArray<JThreadTicket> | undefined;
}): string[] {
  return (thread.jTickets ?? []).flatMap((ticket) => [ticket.key, ticket.url]);
}
