import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import { OrchestrationCommandInvariantError } from "../../../orchestration/Errors.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { TicketsToolkitHandlersLive } from "./handlers.ts";
import { TicketsToolkit } from "./tools.ts";

const THREAD_ID = ThreadId.make("thread-1");

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const thread: OrchestrationThreadShell = {
  id: THREAD_ID,
  projectId: ProjectId.make("project-1"),
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  tickets: [
    {
      url: "https://linear.app/acme/issue/ENG-2",
      key: "ENG-2",
      source: "manual",
      linkedAt: "2026-08-10T00:00:00.000Z",
    },
  ],
  latestTurn: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

const makeHarness = Effect.fn("makeTicketsToolkitHarness")(function* (
  reject: (command: OrchestrationCommand) => boolean = () => false,
) {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      if (reject(command)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "rejected",
        });
      }
      yield* Ref.update(commands, (recorded) => [...recorded, command]);
      return { sequence: 1 };
    });
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: (threadId) =>
        Effect.succeed(threadId === THREAD_ID ? Option.some(thread) : Option.none()),
    }),
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    }),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );
  const toolkit = yield* TicketsToolkit.pipe(
    Effect.provide(TicketsToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof TicketsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof TicketsToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment-1"),
        threadId: THREAD_ID,
        providerSessionId: "provider-session-1",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set<McpInvocationContext.McpCapability>(["pull-requests"]),
        issuedAt: 1,
      }),
      Effect.provide(dependencies),
    );
  return { commands, call };
});

describe("ticket toolkit handlers", () => {
  it.effect("links a recognised URL under its canonical form with source agent", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("link_ticket", {
        url: "https://acme.atlassian.net/browse/proj-7?focusedCommentId=3",
      });
      expect(result).toEqual({
        url: "https://acme.atlassian.net/browse/PROJ-7",
        key: "PROJ-7",
        alreadyLinked: false,
      });
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        {
          type: "thread.j-ticket.link",
          threadId: THREAD_ID,
          url: "https://acme.atlassian.net/browse/PROJ-7",
          key: "PROJ-7",
          source: "agent",
        },
      ]);
    }),
  );

  it.effect("needs a key for a tracker it cannot read, and reports duplicates as linked", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(() => true);
      const error = yield* harness
        .call("link_ticket", { url: "https://tracker.example/t/42" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "TicketUrlInvalidError" });
      const result = yield* harness.call("link_ticket", {
        url: "https://tracker.example/t/42",
        key: "T-42",
      });
      expect(result).toEqual({
        url: "https://tracker.example/t/42",
        key: "T-42",
        alreadyLinked: true,
      });
    }),
  );

  it.effect("reports an already linked ticket under the key it was stored with", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(() => true);
      const result = yield* harness.call("link_ticket", {
        url: "https://linear.app/acme/issue/eng-2",
        key: "Login bug",
      });
      expect(result).toEqual({
        url: "https://linear.app/acme/issue/ENG-2",
        key: "ENG-2",
        alreadyLinked: true,
      });
    }),
  );

  it.effect("unlinks by canonical URL and lists the thread's tickets", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("unlink_ticket", {
        url: "https://linear.app/acme/issue/eng-2/some-slug",
      });
      expect(result).toEqual({ url: "https://linear.app/acme/issue/ENG-2", wasLinked: true });
      expect(yield* harness.call("list_thread_tickets", {})).toEqual({
        tickets: [{ url: "https://linear.app/acme/issue/ENG-2", key: "ENG-2", source: "manual" }],
      });
    }),
  );
});
