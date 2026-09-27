import {
  McpCapabilityUnavailableError,
  ThreadTicketLinkSource,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationEngine.OrchestrationEngineService,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
];

const TicketUrl = TrimmedNonEmptyString.annotate({
  description:
    "The ticket's web URL, for example https://acme.atlassian.net/browse/PROJ-123, https://linear.app/acme/issue/ENG-42 or https://github.com/owner/repo/issues/7.",
});

export const LinkTicketInput = Schema.Struct({
  url: TicketUrl,
  key: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "The ticket's ID as its tracker shows it, for example PROJ-123. Only needed when the tracker is not recognised from the URL.",
    }),
  ),
});

export const UnlinkTicketInput = Schema.Struct({ url: TicketUrl });

export class TicketUrlInvalidError extends Schema.TaggedError<TicketUrlInvalidError>()(
  "TicketUrlInvalidError",
  {},
) {
  override get message(): string {
    return "The ticket ID could not be read from this URL. Pass an http(s) URL, and pass key when the tracker is not recognised.";
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
    return "Could not link the ticket.";
  }
}

export class TicketUnlinkFailedError extends Schema.TaggedError<TicketUnlinkFailedError>()(
  "TicketUnlinkFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not unlink the ticket.";
  }
}

export class TicketListFailedError extends Schema.TaggedError<TicketListFailedError>()(
  "TicketListFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not list the tickets.";
  }
}

export const TicketToolError = Schema.Union([
  McpCapabilityUnavailableError,
  TicketUrlInvalidError,
  TicketThreadNotFoundError,
  TicketLinkFailedError,
  TicketUnlinkFailedError,
  TicketListFailedError,
]);

export const LinkTicketResult = Schema.Struct({
  url: Schema.String,
  key: Schema.String,
  alreadyLinked: Schema.Boolean.annotate({
    description: "True when the ticket was linked to this thread before the call.",
  }),
});

export const UnlinkTicketResult = Schema.Struct({
  url: Schema.String,
  wasLinked: Schema.Boolean.annotate({
    description: "False when the ticket was not linked to this thread to begin with.",
  }),
});

export const ListThreadTicketsResult = Schema.Struct({
  tickets: Schema.Array(
    Schema.Struct({ url: Schema.String, key: Schema.String, source: ThreadTicketLinkSource }),
  ),
});
export type ListThreadTicketsResult = typeof ListThreadTicketsResult.Type;

const LinkTicketTool = Tool.make("link_ticket", {
  description:
    "Link an issue-tracker ticket (Jira, Linear, GitHub, GitLab, Forgejo or Azure DevOps issue, and similar) to this thread, so T3 Code shows it beside the thread and finds the thread when searching for the ticket. Pass the ticket's full URL. Linking an already-linked ticket succeeds with alreadyLinked=true.",
  parameters: LinkTicketInput,
  success: LinkTicketResult,
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
  parameters: UnlinkTicketInput,
  success: UnlinkTicketResult,
  failure: TicketToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unlink ticket from thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ListThreadTicketsTool = Tool.make("list_thread_tickets", {
  description: "List the tickets linked to this thread.",
  success: ListThreadTicketsResult,
  failure: TicketToolError,
  dependencies,
})
  .annotate(Tool.Title, "List thread tickets")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const TicketsToolkit = Toolkit.make(LinkTicketTool, UnlinkTicketTool, ListThreadTicketsTool);
