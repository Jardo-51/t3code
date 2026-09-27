import { ThreadId, ThreadTicketLink, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "./Errors.ts";

/** One row of the fork's `j_projection_thread_tickets` projection table. */
export const ProjectionThreadTicket = Schema.Struct({
  threadId: ThreadId,
  ...ThreadTicketLink.fields,
});
export type ProjectionThreadTicket = typeof ProjectionThreadTicket.Type;

const ThreadIdInput = Schema.Struct({ threadId: ThreadId });
const DeleteInput = Schema.Struct({ threadId: ThreadId, url: TrimmedNonEmptyString });
const NoInput = Schema.Struct({});

function mapError(operation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(`JardoThreadTickets.${operation}:decode`)(cause)
      : toPersistenceSqlError(`JardoThreadTickets.${operation}:query`)(cause);
}

/**
 * Reads and writes thread ticket links. Built on the caller's SqlClient so projector writes join
 * the projection transaction.
 */
export const makeThreadTicketStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadTicket,
    execute: (row) => sql`
      INSERT INTO j_projection_thread_tickets (thread_id, url, key, source, linked_at)
      VALUES (${row.threadId}, ${row.url}, ${row.key}, ${row.source}, ${row.linkedAt})
      ON CONFLICT (thread_id, url)
      DO UPDATE SET
        key = excluded.key,
        source = excluded.source,
        linked_at = excluded.linked_at
    `,
  });

  const deleteRow = SqlSchema.void({
    Request: DeleteInput,
    execute: ({ threadId, url }) => sql`
      DELETE FROM j_projection_thread_tickets
      WHERE thread_id = ${threadId} AND url = ${url}
    `,
  });

  const deleteRowsByThread = SqlSchema.void({
    Request: ThreadIdInput,
    execute: ({ threadId }) => sql`
      DELETE FROM j_projection_thread_tickets WHERE thread_id = ${threadId}
    `,
  });

  const selectColumns = sql`
    thread_id AS "threadId", url, key, source, linked_at AS "linkedAt"
  `;

  const listRowsByThread = SqlSchema.findAll({
    Request: ThreadIdInput,
    Result: ProjectionThreadTicket,
    execute: ({ threadId }) => sql`
      SELECT ${selectColumns}
      FROM j_projection_thread_tickets
      WHERE thread_id = ${threadId}
      ORDER BY linked_at ASC, url ASC
    `,
  });

  const listAllRows = SqlSchema.findAll({
    Request: NoInput,
    Result: ProjectionThreadTicket,
    execute: () => sql`
      SELECT ${selectColumns}
      FROM j_projection_thread_tickets
      ORDER BY linked_at ASC, url ASC
    `,
  });

  return {
    upsert: (row: ProjectionThreadTicket) =>
      upsertRow(row).pipe(Effect.mapError(mapError("upsert"))),
    delete: (input: typeof DeleteInput.Type) =>
      deleteRow(input).pipe(Effect.mapError(mapError("delete"))),
    deleteByThreadId: (threadId: ThreadId) =>
      deleteRowsByThread({ threadId }).pipe(Effect.mapError(mapError("deleteByThreadId"))),
    listByThreadId: (threadId: ThreadId) =>
      listRowsByThread({ threadId }).pipe(Effect.mapError(mapError("listByThreadId"))),
    /** Every link; the table holds a handful of rows per thread, so snapshots read it whole. */
    listAll: () => listAllRows({}).pipe(Effect.mapError(mapError("listAll"))),
  };
});

export type ThreadTicketStore = Effect.Success<typeof makeThreadTicketStore>;

/** Rows grouped per thread as `ThreadTicketLink`s, in link order. */
export function groupTicketsByThread(
  rows: ReadonlyArray<ProjectionThreadTicket>,
): Map<ThreadId, Array<ThreadTicketLink>> {
  const byThread = new Map<ThreadId, Array<ThreadTicketLink>>();
  for (const { threadId, ...link } of rows) {
    const links = byThread.get(threadId);
    if (links === undefined) byThread.set(threadId, [link]);
    else links.push(link);
  }
  return byThread;
}
