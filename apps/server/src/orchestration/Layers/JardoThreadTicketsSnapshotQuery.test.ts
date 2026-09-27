import { CommandId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { makeSqlitePersistenceLive } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-tickets");
const THREAD_ID = ThreadId.make("thread-tickets");
const TICKET = { url: "https://acme.atlassian.net/browse/PROJ-1", key: "PROJ-1" };

/** A full engine over a database file; providing it twice in a row is a server restart. */
const orchestrationOn = (databasePath: string) =>
  Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    OrchestrationProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(makeSqlitePersistenceLive(databasePath)),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-thread-tickets-test-" })),
  );

const dispatch = (command: Parameters<OrchestrationEngineService["Service"]["dispatch"]>[0]) =>
  Effect.flatMap(Effect.service(OrchestrationEngineService), (engine) => engine.dispatch(command));

const threadTickets = Effect.gen(function* () {
  const query = yield* ProjectionSnapshotQuery;
  const shell = yield* query.getThreadShellById(THREAD_ID);
  const shells = yield* query.getShellSnapshot();
  const detail = yield* query.getThreadDetailSnapshot(THREAD_ID);
  return {
    byId: Option.getOrNull(shell)?.tickets,
    snapshot: shells.threads.find((thread) => thread.id === THREAD_ID)?.tickets,
    detail: Option.getOrNull(detail)?.thread.tickets,
  };
});

it.layer(NodeServices.layer)("thread ticket projection", (it) => {
  it.effect(
    "serves linked tickets from every thread read, across restarts, until the thread is deleted",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-thread-tickets-",
        });
        const orchestration = orchestrationOn(path.join(directory, "state.sqlite"));

        yield* Effect.gen(function* () {
          yield* dispatch({
            type: "project.create",
            commandId: CommandId.make("tickets-project"),
            projectId: PROJECT_ID,
            title: "Tickets",
            workspaceRoot: "/tmp/tickets",
            createdAt: NOW,
          });
          yield* dispatch({
            type: "thread.create",
            commandId: CommandId.make("tickets-thread"),
            threadId: THREAD_ID,
            projectId: PROJECT_ID,
            title: "Tickets",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: NOW,
          });
          expect((yield* threadTickets).byId).toBeUndefined();

          yield* dispatch({
            type: "thread.j-ticket.link",
            commandId: CommandId.make("tickets-link"),
            threadId: THREAD_ID,
            ...TICKET,
            source: "manual",
          });
          const linked = [{ ...TICKET, source: "manual", linkedAt: expect.any(String) }];
          expect(yield* threadTickets).toEqual({ byId: linked, snapshot: linked, detail: linked });
        }).pipe(Effect.provide(orchestration));

        // The engine's command model is rebuilt from the projection, so after a restart it
        // still knows the ticket is linked.
        yield* Effect.gen(function* () {
          const duplicate = yield* dispatch({
            type: "thread.j-ticket.link",
            commandId: CommandId.make("tickets-link-again"),
            threadId: THREAD_ID,
            ...TICKET,
            source: "agent",
          }).pipe(Effect.flip);
          expect(duplicate._tag).toBe("OrchestrationCommandInvariantError");

          yield* dispatch({
            type: "thread.delete",
            commandId: CommandId.make("tickets-delete"),
            threadId: THREAD_ID,
          });
          const snapshot = yield* Effect.flatMap(Effect.service(ProjectionSnapshotQuery), (query) =>
            query.getSnapshot(),
          );
          expect(
            snapshot.threads.find((thread) => thread.id === THREAD_ID)?.tickets,
          ).toBeUndefined();
        }).pipe(Effect.provide(orchestration));
      }),
  );
});
