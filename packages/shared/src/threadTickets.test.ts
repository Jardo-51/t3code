import { describe, expect, it } from "vite-plus/test";

import {
  canonicalTicketUrl,
  parseTicketUrl,
  resolveTicketReference,
  threadTicketSearchTerms,
} from "./threadTickets.ts";

describe("parseTicketUrl", () => {
  it.each([
    [
      "https://acme.atlassian.net/browse/proj-123?focusedCommentId=1#comment",
      { key: "PROJ-123", url: "https://acme.atlassian.net/browse/PROJ-123" },
    ],
    [
      "https://jira.corp.example/jira/browse/OPS_2-7",
      { key: "OPS_2-7", url: "https://jira.corp.example/jira/browse/OPS_2-7" },
    ],
    [
      "https://acme.atlassian.net/jira/software/projects/PROJ/boards/1?selectedIssue=PROJ-9",
      { key: "PROJ-9", url: "https://acme.atlassian.net/browse/PROJ-9" },
    ],
    [
      "https://linear.app/acme/issue/eng-42/fix-the-thing",
      { key: "ENG-42", url: "https://linear.app/acme/issue/ENG-42" },
    ],
    [
      "https://github.com/owner/repo/issues/12#issuecomment-1",
      { key: "repo#12", url: "https://github.com/owner/repo/issues/12" },
    ],
    [
      "https://codeberg.org/owner/repo/issues/3",
      { key: "repo#3", url: "https://codeberg.org/owner/repo/issues/3" },
    ],
    [
      "https://gitlab.example.com/group/sub/repo/-/issues/5/designs",
      { key: "repo#5", url: "https://gitlab.example.com/group/sub/repo/-/issues/5" },
    ],
    [
      "https://gitlab.com/group/repo/-/work_items/8",
      { key: "repo#8", url: "https://gitlab.com/group/repo/-/work_items/8" },
    ],
    [
      "https://dev.azure.com/org/My%20Project/_workitems/edit/77/",
      { key: "My Project#77", url: "https://dev.azure.com/org/My%20Project/_workitems/edit/77" },
    ],
    [
      "https://org.visualstudio.com/Proj/_workitems/edit/78",
      { key: "Proj#78", url: "https://org.visualstudio.com/Proj/_workitems/edit/78" },
    ],
    [
      "https://youtrack.example.com/issue/abc-5/Some-title#comment",
      { key: "ABC-5", url: "https://youtrack.example.com/issue/abc-5/Some-title" },
    ],
  ])("names %s", (input, expected) => {
    expect(parseTicketUrl(input)).toEqual(expected);
  });

  it.each([
    [
      "https://gitlab.com/group/repo-2/-/merge_requests/5",
      { key: "REPO-2", url: "https://gitlab.com/group/repo-2/-/merge_requests/5" },
    ],
    [
      "https://tree.taiga.io/project/acme-2024/us/42",
      { key: "ACME-2024", url: "https://tree.taiga.io/project/acme-2024/us/42" },
    ],
    [
      "https://tracker.example/view/abc-5?tab=history",
      { key: "ABC-5", url: "https://tracker.example/view/abc-5?tab=history" },
    ],
  ])("keeps an unknown tracker's URL for %s", (input, expected) => {
    expect(parseTicketUrl(input)).toEqual(expected);
  });

  it.each([
    "https://example.com/tickets/42",
    "https://github.com/owner/repo/pull/12",
    "javascript:alert(1)",
    "not a url",
  ])("does not name %s", (input) => {
    expect(parseTicketUrl(input)).toBeNull();
  });
});

describe("resolveTicketReference", () => {
  it("prefers the caller's key but keeps the canonical URL", () => {
    expect(
      resolveTicketReference({ url: "https://acme.atlassian.net/browse/PROJ-1#x", key: " P1 " }),
    ).toEqual({ key: "P1", url: "https://acme.atlassian.net/browse/PROJ-1" });
  });

  it("accepts an unreadable tracker when a key is given", () => {
    expect(resolveTicketReference({ url: "https://example.com/tickets/42", key: "T-42" })).toEqual({
      key: "T-42",
      url: "https://example.com/tickets/42",
    });
    expect(resolveTicketReference({ url: "https://example.com/tickets/42" })).toBeNull();
    expect(resolveTicketReference({ url: "ftp://example.com/PROJ-1", key: "PROJ-1" })).toBeNull();
  });
});

describe("canonicalTicketUrl", () => {
  it("matches what a link stored, for readable and unreadable trackers", () => {
    expect(canonicalTicketUrl("https://acme.atlassian.net/browse/proj-1?x=1")).toBe(
      "https://acme.atlassian.net/browse/PROJ-1",
    );
    expect(canonicalTicketUrl("https://example.com/tickets/42")).toBe(
      "https://example.com/tickets/42",
    );
    expect(canonicalTicketUrl("nope")).toBeNull();
  });
});

describe("threadTicketSearchTerms", () => {
  it("lets a thread be found by any linked ticket's key or URL", () => {
    expect(threadTicketSearchTerms({})).toEqual([]);
    expect(
      threadTicketSearchTerms({
        tickets: [
          {
            key: "PROJ-1",
            url: "https://acme.atlassian.net/browse/PROJ-1",
            source: "agent",
            linkedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    ).toEqual(["PROJ-1", "https://acme.atlassian.net/browse/PROJ-1"]);
  });
});
