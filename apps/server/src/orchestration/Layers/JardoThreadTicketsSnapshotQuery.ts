import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  groupTicketsByThread,
  makeThreadTicketStore,
  type ProjectionThreadTicket,
} from "../../persistence/JardoThreadTickets.ts";
import type { ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";

const toLink = ({ threadId: _threadId, ...link }: ProjectionThreadTicket) => link;

/**
 * Adds the fork's ticket links to every thread the snapshot query returns. Kept as a wrapper so
 * upstream's query module stays untouched apart from the layer that applies it.
 *
 * Tickets are read after the wrapped query, so they can be newer than its snapshot sequence.
 * That is harmless: replaying a ticket event over a state that already reflects it is a no-op.
 */
export const withThreadTickets = Effect.fn("withThreadTickets")(function* (
  base: ProjectionSnapshotQueryShape,
) {
  const store = yield* makeThreadTicketStore;

  const attachAll = <T extends { readonly id: ThreadId }>(threads: ReadonlyArray<T>) =>
    store.listAll().pipe(
      Effect.map((rows) => {
        if (rows.length === 0) return threads;
        const byThread = groupTicketsByThread(rows);
        return threads.map((thread) => {
          const tickets = byThread.get(thread.id);
          return tickets === undefined ? thread : { ...thread, tickets };
        });
      }),
    );

  const attachOne = <T extends { readonly id: ThreadId }>(thread: Option.Option<T>) =>
    Option.isNone(thread)
      ? Effect.succeed(thread)
      : store
          .listByThreadId(thread.value.id)
          .pipe(
            Effect.map((rows) =>
              Option.some(
                rows.length === 0 ? thread.value : { ...thread.value, tickets: rows.map(toLink) },
              ),
            ),
          );

  const withThreads = <S extends { readonly threads: ReadonlyArray<{ readonly id: ThreadId }> }>(
    snapshot: S,
  ) => attachAll(snapshot.threads).pipe(Effect.map((threads) => ({ ...snapshot, threads }) as S));

  return {
    ...base,
    getCommandReadModel: () => base.getCommandReadModel().pipe(Effect.flatMap(withThreads)),
    getSnapshot: () => base.getSnapshot().pipe(Effect.flatMap(withThreads)),
    getShellSnapshot: () => base.getShellSnapshot().pipe(Effect.flatMap(withThreads)),
    getArchivedShellSnapshot: () =>
      base.getArchivedShellSnapshot().pipe(Effect.flatMap(withThreads)),
    getThreadShellById: (threadId) =>
      base.getThreadShellById(threadId).pipe(Effect.flatMap(attachOne)),
    getThreadDetailById: (threadId, query) =>
      base.getThreadDetailById(threadId, query).pipe(Effect.flatMap(attachOne)),
    getThreadDetailSnapshot: (threadId, window) =>
      base
        .getThreadDetailSnapshot(threadId, window)
        .pipe(
          Effect.flatMap((snapshot) =>
            Option.isNone(snapshot)
              ? Effect.succeed(snapshot)
              : attachOne(Option.some(snapshot.value.thread)).pipe(
                  Effect.map(Option.map((thread) => ({ ...snapshot.value, thread }))),
                ),
          ),
        ),
  } satisfies ProjectionSnapshotQueryShape;
});
