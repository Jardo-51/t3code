import type { ThreadTicketLink } from "@t3tools/contracts";

/** A ticket as a thread link stores it: the canonical URL and the label shown for it. */
export interface TicketReference {
  readonly url: string;
  readonly key: string;
}

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/u;

function segmentsOf(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parseHttpUrl(targetUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(targetUrl.trim());
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url : null;
}

/**
 * The key and canonical URL of a ticket on a tracker whose URLs name the ticket, or null.
 *
 * Only the URL is read; no tracker is contacted. The canonical URL drops whatever a tracker adds
 * around the ticket (board views, comment anchors, slugs) so two links to the same ticket compare
 * equal. Unlike change-request parsing, a loose match costs nothing here: the caller already
 * decided the URL is a ticket, this only names it.
 */
export function parseTicketUrl(targetUrl: string): TicketReference | null {
  const url = parseHttpUrl(targetUrl);
  if (url === null) return null;
  const host = url.hostname;
  const path = url.pathname;

  // Jira, Cloud or self-hosted under any context path: {prefix}/browse/{KEY}
  const jira = /^(.*?)\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:\/|$)/u.exec(path);
  if (jira) {
    const key = jira[2]!.toUpperCase();
    return { key, url: `${url.origin}${jira[1]}/browse/${key}` };
  }
  // Jira Cloud boards and backlogs open a ticket as ?selectedIssue={KEY}.
  const selectedIssue = url.searchParams.get("selectedIssue");
  if (host.endsWith(".atlassian.net") && selectedIssue && KEY_PATTERN.test(selectedIssue)) {
    const key = selectedIssue.toUpperCase();
    return { key, url: `${url.origin}/browse/${key}` };
  }
  // Linear: /{workspace}/issue/{KEY}/{optional-slug}
  if (host === "linear.app") {
    const match = /^\/([^/]+)\/issue\/([A-Za-z0-9]+-\d+)(?:\/|$)/u.exec(path);
    if (match) {
      const key = match[2]!.toUpperCase();
      return { key, url: `${url.origin}/${match[1]}/issue/${key}` };
    }
  }
  // GitLab, self-hosted included: /{group}/[{subgroup}/...]{repo}/-/issues/{n}
  const gitlab = /^\/(.+?)\/-\/(issues|work_items)\/(\d+)(?:\/|$)/u.exec(path);
  if (gitlab) {
    const repository = gitlab[1]!;
    return {
      key: `${decodeSegment(segmentsOf(repository).at(-1) ?? repository)}#${gitlab[3]}`,
      url: `${url.origin}/${repository}/-/${gitlab[2]}/${gitlab[3]}`,
    };
  }
  // Azure DevOps: /{organization}/{project}/_workitems/edit/{n}, or {org}.visualstudio.com.
  const azure = /^\/(.+?)\/_workitems\/edit\/(\d+)(?:\/|$)/u.exec(path);
  if (azure) {
    const prefix = azure[1]!;
    return {
      key: `${decodeSegment(segmentsOf(prefix).at(-1) ?? prefix)}#${azure[2]}`,
      url: `${url.origin}/${prefix}/_workitems/edit/${azure[2]}`,
    };
  }
  // GitHub, Forgejo, Gitea and Bitbucket share one shape: /{owner}/{repo}/issues/{n}
  const issue = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\/|$)/u.exec(path);
  if (issue) {
    return {
      key: `${decodeSegment(issue[2]!)}#${issue[3]}`,
      url: `${url.origin}/${issue[1]}/${issue[2]}/issues/${issue[3]}`,
    };
  }
  // Anything else that names a KEY-123 style ticket in its path (YouTrack and the like).
  const segments = segmentsOf(path);
  const keyIndex = segments.findIndex((segment) => KEY_PATTERN.test(segment));
  if (keyIndex !== -1) {
    const key = segments[keyIndex]!.toUpperCase();
    return {
      key,
      url: `${url.origin}/${[...segments.slice(0, keyIndex), key].join("/")}`,
    };
  }
  return null;
}

/**
 * The link to store for a ticket URL: the parsed key and canonical URL, or the caller's key for a
 * tracker this cannot read. Null when the URL is not an http(s) URL, or is unreadable and no key
 * was given.
 */
export function resolveTicketReference(input: {
  readonly url: string;
  readonly key?: string | undefined;
}): TicketReference | null {
  const url = parseHttpUrl(input.url);
  if (url === null) return null;
  const parsed = parseTicketUrl(url.href);
  const key = input.key?.trim();
  if (key) return { url: parsed?.url ?? url.href, key };
  return parsed;
}

/** The identity a ticket URL is stored under, so an unlink finds what a link wrote. */
export function canonicalTicketUrl(targetUrl: string): string | null {
  const url = parseHttpUrl(targetUrl);
  if (url === null) return null;
  return parseTicketUrl(url.href)?.url ?? url.href;
}

export function threadTicketSearchTerms(thread: {
  readonly tickets?: ReadonlyArray<ThreadTicketLink> | undefined;
}): string[] {
  return (thread.tickets ?? []).flatMap((ticket) => [ticket.key, ticket.url]);
}
