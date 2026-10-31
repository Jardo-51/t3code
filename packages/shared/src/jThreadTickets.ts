import { JThreadTicketUrl } from "@t3tools/contracts";
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
  return parseTicket(input)?.key ?? null;
}

/**
 * Which ticket a URL points at, for matching links. Trackers serve one ticket under several URLs
 * (a Linear title slug, Jira's `?focusedCommentId=` or board `?selectedIssue=`, a `#fragment`), so
 * a `PROJ-123` style ID counts per host, which merges same-ID tickets of two workspaces sharing
 * one host. Computed from the URL, never stored, so links saved before this rule match too.
 */
export function ticketIdentity(input: string): string {
  return parseTicket(input)?.identity ?? input;
}

function parseTicket(input: string): { key: string | null; identity: string } | null {
  const href = parseTicketUrl(input);
  if (href === null) return null;
  const url = new URL(href);
  const path = safeDecode(url.pathname);
  const pathUpTo = (match: RegExpExecArray) =>
    `${url.host}${path.slice(0, match.index + match[0].length).replace(/\/$/u, "")}`;
  const azure = AZURE_WORK_ITEM.exec(path);
  if (azure) return { key: `AB#${azure[1]}`, identity: pathUpTo(azure) };
  // `repo#5` alone would merge issues of same-named repositories, so the whole path counts.
  const issue = NUMBERED_ISSUE.exec(path);
  if (issue) return { key: `${issue[1]}#${issue[2]}`, identity: pathUpTo(issue) };
  const key = PROJECT_KEY.exec(path) ?? PROJECT_KEY.exec(safeDecode(`${url.search}${url.hash}`));
  if (key) return { key: key[1]!, identity: `${url.host} ${key[1]}` };
  return { key: null, identity: `${url.host}${path.replace(/\/$/u, "")}${url.search}` };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
