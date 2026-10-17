import { CommandId, type OrchestrationV2ServerCommand, type ThreadId } from "@t3tools/contracts";
import { parseTicketUrl, ticketIdentity, ticketKeyFromUrl } from "@t3tools/shared/jThreadTickets";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  JTicketsToolkit,
  TicketKeyRequiredError,
  TicketLinkFailedError,
  TicketThreadNotFoundError,
  TicketThreadRequiredError,
  TicketUrlInvalidError,
} from "./tools.ts";

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const crypto = yield* Crypto.Crypto;

  const requireThread = Effect.fn("JTicketsToolkit.requireThread")(function* (
    requested: ThreadId | undefined,
  ) {
    const scope = yield* McpInvocationContext.requireMcpCapability("orchestration");
    const threadId = requested ?? scope.thread?.threadId;
    if (threadId === undefined) return yield* new TicketThreadRequiredError();
    const thread = yield* engine
      .getThreadShell(threadId)
      .pipe(Effect.mapError((cause) => new TicketLinkFailedError({ cause })));
    if (thread === null || thread.deletedAt !== null) {
      return yield* new TicketThreadNotFoundError({ threadId });
    }
    return thread;
  });

  const requireUrl = (input: string) => {
    const url = parseTicketUrl(input);
    return url === null ? Effect.fail(new TicketUrlInvalidError()) : Effect.succeed(url);
  };

  const dispatch = Effect.fn("JTicketsToolkit.dispatch")(function* (
    command: Extract<
      OrchestrationV2ServerCommand,
      { readonly type: "thread.j-ticket.link" | "thread.j-ticket.unlink" }
    >,
  ) {
    yield* engine
      .dispatch(command)
      .pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause as Cause.Cause<never>)
            : Effect.fail(new TicketLinkFailedError({ cause })),
        ),
      );
  });

  const commandId = (tag: string, threadId: ThreadId) =>
    crypto.randomUUIDv4().pipe(
      Effect.orDie,
      Effect.map((uuid) => CommandId.make(`server:${tag}:${threadId}:${uuid}`)),
    );

  const writesThread = <P extends { readonly threadId?: ThreadId | undefined }, A, E, R>(
    handle: (params: P) => Effect.Effect<A, E, R>,
  ) => McpToolAccess.writesThreads((params: P) => [params.threadId], handle);

  return {
    link_ticket: writesThread((input) =>
      Effect.gen(function* () {
        const thread = yield* requireThread(input.threadId);
        const url = yield* requireUrl(input.url);
        const key = input.key ?? ticketKeyFromUrl(url);
        if (key === null) return yield* new TicketKeyRequiredError();
        const identity = ticketIdentity(url);
        const existing = thread.jTickets?.find((ticket) => ticketIdentity(ticket.url) === identity);
        if (existing !== undefined && existing.key === key) {
          return { url, key, alreadyLinked: true };
        }
        yield* dispatch({
          type: "thread.j-ticket.link",
          commandId: yield* commandId("mcp-ticket-link", thread.id),
          threadId: thread.id,
          url,
          key,
          source: "agent",
        });
        return { url, key, alreadyLinked: existing !== undefined };
      }),
    ),
    unlink_ticket: writesThread((input) =>
      Effect.gen(function* () {
        const thread = yield* requireThread(input.threadId);
        const url = yield* requireUrl(input.url);
        const identity = ticketIdentity(url);
        if (!thread.jTickets?.some((ticket) => ticketIdentity(ticket.url) === identity)) {
          return { url, wasLinked: false };
        }
        yield* dispatch({
          type: "thread.j-ticket.unlink",
          commandId: yield* commandId("mcp-ticket-unlink", thread.id),
          threadId: thread.id,
          url,
        });
        return { url, wasLinked: true };
      }),
    ),
  } satisfies McpToolAccess.Handlers<typeof JTicketsToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(JTicketsToolkit, make);
