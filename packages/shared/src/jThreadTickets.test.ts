import { describe, expect, it } from "vite-plus/test";

import { parseTicketUrl, ticketIdentity, ticketKeyFromUrl } from "./jThreadTickets.ts";

describe("ticketKeyFromUrl", () => {
  it.each([
    ["https://acme.atlassian.net/browse/PROJ-123", "PROJ-123"],
    ["https://jira.example.com/browse/EUI_PRMS-2537?focusedCommentId=1", "EUI_PRMS-2537"],
    [
      "https://acme.atlassian.net/jira/software/projects/PROJ/boards/1?selectedIssue=PROJ-42",
      "PROJ-42",
    ],
    ["https://linear.app/acme/issue/ENG-7/fix-the-thing", "ENG-7"],
    ["https://github.com/pingdotgg/t3code/issues/13625", "t3code#13625"],
    ["https://gitlab.com/group/sub/repo/-/issues/5", "repo#5"],
    ["https://gitlab.com/group/repo/-/work_items/9", "repo#9"],
    ["https://codeberg.org/owner/repo/issues/12", "repo#12"],
    ["https://bitbucket.org/owner/repo/issues/3/some-title", "repo#3"],
    ["https://dev.azure.com/org/project/_workitems/edit/4711", "AB#4711"],
  ])("reads %s as %s", (url, key) => {
    expect(ticketKeyFromUrl(url)).toBe(key);
  });

  it.each([
    "https://example.com/tickets/view?id=88",
    "https://github.com/pingdotgg/t3code/pull/12",
    "not a url",
    "ftp://example.com/browse/PROJ-1",
  ])("finds no key in %s", (url) => {
    expect(ticketKeyFromUrl(url)).toBeNull();
  });
});

describe("parseTicketUrl", () => {
  it("accepts trimmed http(s) URLs only", () => {
    expect(parseTicketUrl("  https://linear.app/acme/issue/ENG-7 ")).toBe(
      "https://linear.app/acme/issue/ENG-7",
    );
    expect(parseTicketUrl("PROJ-123")).toBeNull();
    expect(parseTicketUrl("javascript:alert(1)")).toBeNull();
    expect(parseTicketUrl("file:///etc/passwd")).toBeNull();
    expect(parseTicketUrl(`https://example.com/${"a".repeat(2048)}`)).toBeNull();
  });
});

describe("ticketIdentity", () => {
  it.each([
    ["https://linear.app/acme/issue/ENG-7", "https://linear.app/acme/issue/ENG-7/fix-the-thing"],
    [
      "https://acme.atlassian.net/browse/PROJ-1",
      "https://acme.atlassian.net/jira/software/projects/PROJ/boards/1?selectedIssue=PROJ-1",
    ],
    ["https://acme.atlassian.net/browse/PROJ-1", "http://acme.atlassian.net/browse/PROJ-1#comment"],
    [
      "https://github.com/owner/repo/issues/5",
      "https://github.com/owner/repo/issues/5#issuecomment-1",
    ],
    ["https://example.com/tickets/88", "https://example.com/tickets/88/#top"],
  ])("matches %s and %s", (first, second) => {
    expect(ticketIdentity(first)).toBe(ticketIdentity(second));
  });

  it.each([
    ["https://acme.atlassian.net/browse/PROJ-1", "https://other.atlassian.net/browse/PROJ-1"],
    ["https://github.com/a/repo/issues/5", "https://github.com/b/repo/issues/5"],
    ["https://example.com/view?id=88", "https://example.com/view?id=89"],
  ])("tells %s and %s apart", (first, second) => {
    expect(ticketIdentity(first)).not.toBe(ticketIdentity(second));
  });
});
