import {
  McpCapabilityUnavailableError,
  OrchestratorMcpFailure,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  Orchestrator.OrchestratorV2,
];

const threadIdInput = Schema.optional(
  ThreadId.annotate({ description: "Thread to act on. Omit for this thread." }),
);
const urlInput = TrimmedNonEmptyString.annotate({
  description: "The ticket's web URL, for example https://acme.atlassian.net/browse/PROJ-123.",
});

export class TicketUrlInvalidError extends Schema.TaggedError<TicketUrlInvalidError>()(
  "TicketUrlInvalidError",
  {},
) {
  override get message(): string {
    return "url must be the ticket's http(s) web address.";
  }
}

export class TicketKeyRequiredError extends Schema.TaggedError<TicketKeyRequiredError>()(
  "TicketKeyRequiredError",
  {},
) {
  override get message(): string {
    return "The ticket ID cannot be read from this URL. Pass key, the ID the tracker shows.";
  }
}

export class TicketThreadRequiredError extends Schema.TaggedError<TicketThreadRequiredError>()(
  "TicketThreadRequiredError",
  {},
) {
  override get message(): string {
    return "Pass threadId: this MCP client is not running inside a T3 thread.";
  }
}

export class TicketThreadNotFoundError extends Schema.TaggedError<TicketThreadNotFoundError>()(
  "TicketThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export class TicketLinkFailedError extends Schema.TaggedError<TicketLinkFailedError>()(
  "TicketLinkFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not change the thread's ticket links.";
  }
}

export const TicketToolError = Schema.Union([
  OrchestratorMcpFailure,
  McpCapabilityUnavailableError,
  TicketUrlInvalidError,
  TicketKeyRequiredError,
  TicketThreadRequiredError,
  TicketThreadNotFoundError,
  TicketLinkFailedError,
]);

/**
 * Sent as the MCP server's instructions rather than in the provider runtime instructions, which
 * upstream's recorded replay fixtures compare verbatim.
 */
export const J_TICKET_MCP_INSTRUCTIONS =
  "When this server exposes link_ticket, call it with the URL of the issue-tracker ticket the thread works on as soon as you know it, for example when the user pastes it or the branch or task refers to it. Link each ticket the thread works on, but not tickets mentioned only as background. Linking an already-linked ticket is safe.";

const LinkTicketTool = Tool.make("link_ticket", {
  description:
    "Link the issue-tracker ticket (Jira, Linear, GitHub or GitLab issue, and so on) this thread works on, so the user sees it beside the thread, can open it, and can find every thread for it. Call it as soon as you know the ticket's URL, for example when the user pastes it or the branch or task refers to it. Do not link tickets mentioned only as background. The ticket ID is read from the URL; pass key when the tracker's URLs contain none. Linking an already-linked ticket succeeds with alreadyLinked=true.",
  parameters: Schema.Struct({
    threadId: threadIdInput,
    url: urlInput,
    key: Schema.optional(
      TrimmedNonEmptyString.annotate({
        description: "The ID the tracker shows for the ticket, such as PROJ-123.",
      }),
    ),
  }),
  success: Schema.Struct({
    url: Schema.String,
    key: Schema.String,
    alreadyLinked: Schema.Boolean,
  }),
  failure: TicketToolError,
  dependencies,
})
  .annotate(Tool.Title, "Link ticket to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UnlinkTicketTool = Tool.make("unlink_ticket", {
  description:
    "Remove a ticket link from this thread, for example one linked by mistake. Unlinking a ticket that is not linked succeeds with wasLinked=false.",
  parameters: Schema.Struct({ threadId: threadIdInput, url: urlInput }),
  success: Schema.Struct({ url: Schema.String, wasLinked: Schema.Boolean }),
  failure: TicketToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unlink ticket from thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const JTicketsToolkit = Toolkit.make(LinkTicketTool, UnlinkTicketTool);
