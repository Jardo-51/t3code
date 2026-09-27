import { CommandId, type OrchestrationThreadShell, type ThreadId } from "@t3tools/contracts";
import { canonicalTicketUrl, resolveTicketReference } from "@t3tools/shared/threadTickets";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  type ListThreadTicketsResult,
  TicketLinkFailedError,
  TicketListFailedError,
  TicketsToolkit,
  TicketThreadNotFoundError,
  TicketUnlinkFailedError,
  TicketUrlInvalidError,
} from "./tools.ts";

/** What list_thread_tickets reports from a thread shell. */
export function listThreadTickets(
  thread: Pick<OrchestrationThreadShell, "tickets">,
): ListThreadTicketsResult {
  return {
    tickets: (thread.tickets ?? []).map(({ url, key, source }) => ({ url, key, source })),
  };
}

type Failure =
  | typeof TicketLinkFailedError
  | typeof TicketUnlinkFailedError
  | typeof TicketListFailedError;

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const commandId = (tag: string, threadId: ThreadId) =>
    crypto.randomUUIDv4.pipe(
      Effect.orDie,
      Effect.map((uuid) => CommandId.make(`server:${tag}:${threadId}:${uuid}`)),
    );

  const requireThread = Effect.fn("TicketsToolkit.requireThread")(function* (Failure: Failure) {
    // Every agent session is granted thread linking under this capability; tickets ride on it.
    const scope = yield* McpInvocationContext.requireMcpCapability("pull-requests");
    const thread = yield* snapshots
      .getThreadShellById(scope.threadId)
      .pipe(Effect.mapError((cause) => new Failure({ cause })));
    if (Option.isNone(thread)) {
      return yield* new TicketThreadNotFoundError({ threadId: scope.threadId });
    }
    return thread.value;
  });

  const dispatchFailure =
    (Failure: typeof TicketLinkFailedError | typeof TicketUnlinkFailedError) =>
    <E>(
      cause: Cause.Cause<E>,
    ): Effect.Effect<never, TicketLinkFailedError | TicketUnlinkFailedError> =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause as Cause.Cause<never>)
        : Effect.fail(new Failure({ cause }));

  return TicketsToolkit.of({
    link_ticket: (input) =>
      Effect.gen(function* () {
        const thread = yield* requireThread(TicketLinkFailedError);
        const ticket = resolveTicketReference(input);
        if (ticket === null) {
          return yield* new TicketUrlInvalidError({});
        }
        const alreadyLinked = yield* engine
          .dispatch({
            type: "thread.j-ticket.link",
            commandId: yield* commandId("mcp-ticket-link", thread.id),
            threadId: thread.id,
            url: ticket.url,
            key: ticket.key,
            source: "agent",
          })
          .pipe(
            Effect.as(false),
            // The decider rejects a second link of the same ticket; for the agent that is the
            // outcome it asked for, not an error.
            Effect.catchTags({ OrchestrationCommandInvariantError: () => Effect.succeed(true) }),
            Effect.catchCause(dispatchFailure(TicketLinkFailedError)),
          );
        // A duplicate keeps the label it was stored under, so report that one.
        const existing = alreadyLinked
          ? (thread.tickets ?? []).find((entry) => entry.url === ticket.url)
          : undefined;
        return { url: ticket.url, key: existing?.key ?? ticket.key, alreadyLinked };
      }),
    unlink_ticket: (input) =>
      Effect.gen(function* () {
        const thread = yield* requireThread(TicketUnlinkFailedError);
        const url = canonicalTicketUrl(input.url);
        if (url === null) {
          return yield* new TicketUrlInvalidError({});
        }
        const wasLinked = yield* engine
          .dispatch({
            type: "thread.j-ticket.unlink",
            commandId: yield* commandId("mcp-ticket-unlink", thread.id),
            threadId: thread.id,
            url,
          })
          .pipe(
            Effect.as(true),
            Effect.catchTags({ OrchestrationCommandInvariantError: () => Effect.succeed(false) }),
            Effect.catchCause(dispatchFailure(TicketUnlinkFailedError)),
          );
        return { url, wasLinked };
      }),
    list_thread_tickets: () =>
      requireThread(TicketListFailedError).pipe(Effect.map(listThreadTickets)),
  });
});

export const TicketsToolkitHandlersLive = TicketsToolkit.toLayer(make);
