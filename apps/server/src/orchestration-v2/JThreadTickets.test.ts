import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { applyJThreadTicketCommand, type JThreadTicketCommand } from "./JThreadTickets.ts";

const threadId = ThreadId.make("thread:tickets");
const createdAt = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");
const now = DateTime.makeUnsafe("2026-10-02T00:00:00.000Z");
const later = DateTime.makeUnsafe("2026-10-03T00:00:00.000Z");
const url = "https://acme.atlassian.net/browse/PROJ-1";

const thread: OrchestrationV2AppThread = {
  id: threadId,
  createdBy: "user",
  creationSource: "web",
  projectId: ProjectId.make("project:tickets"),
  title: "Tickets",
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt,
  updatedAt: createdAt,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};

const link = (key: string, source: "agent" | "manual", target = url): JThreadTicketCommand => ({
  type: "thread.j-ticket.link",
  commandId: CommandId.make(`link:${key}`),
  threadId,
  url: target,
  key,
  source,
});

describe("applyJThreadTicketCommand", () => {
  it("links a ticket once and keeps its first link time", () => {
    const linked = applyJThreadTicketCommand(thread, link("PROJ-1", "agent"), now);
    assert.deepStrictEqual(linked.jTickets, [
      { url, key: "PROJ-1", source: "agent", linkedAt: "2026-10-02T00:00:00.000Z" },
    ]);
    assert.strictEqual(linked.updatedAt, now);
    assert.strictEqual(applyJThreadTicketCommand(linked, link("PROJ-1", "manual"), later), linked);
  });

  it("lets the user correct the shown ID but not an agent override the user's", () => {
    const agent = applyJThreadTicketCommand(thread, link("PROJ-1", "agent"), now);
    const corrected = applyJThreadTicketCommand(agent, link("Payments 1", "manual"), later);
    assert.deepStrictEqual(corrected.jTickets, [
      { url, key: "Payments 1", source: "manual", linkedAt: "2026-10-02T00:00:00.000Z" },
    ]);
    assert.strictEqual(
      applyJThreadTicketCommand(corrected, link("PROJ-1", "agent"), later),
      corrected,
    );
  });

  it("unlinks only the matching ticket", () => {
    const other = "https://linear.app/acme/issue/ENG-2";
    const linked = applyJThreadTicketCommand(
      applyJThreadTicketCommand(thread, link("PROJ-1", "agent"), now),
      link("ENG-2", "agent", other),
      now,
    );
    const unlink: JThreadTicketCommand = {
      type: "thread.j-ticket.unlink",
      commandId: CommandId.make("unlink"),
      threadId,
      url,
    };
    const unlinked = applyJThreadTicketCommand(linked, unlink, later);
    assert.deepStrictEqual(
      unlinked.jTickets?.map((ticket) => ticket.url),
      [other],
    );
    assert.strictEqual(applyJThreadTicketCommand(unlinked, unlink, later), unlinked);
  });
});
