import {
  EventId,
  JThreadTicket,
  type OrchestrationV2AppThread,
  OrchestrationV2AppThreadJson,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";

import type * as EventSink from "../EventSink.ts";

interface LegacyTicketRow {
  readonly thread_id: string;
  readonly url: string;
  readonly key: string;
  readonly source: string;
  readonly linked_at: string;
  readonly payload_json: string;
}

const decodeStoredThread = Schema.decodeUnknownOption(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);
const decodeTicket = Schema.decodeUnknownOption(JThreadTicket);

/**
 * Copies V1 `j_projection_thread_tickets` links onto imported V2 threads; the table stays as the
 * import source. A payload without `jTickets` predates this import, so each thread imports once
 * and later unlinks stick while only fork servers write it (docs/jardo/forking-strategy.md).
 */
export const importJLegacyThreadTickets = Effect.fn("importJLegacyThreadTickets")(function* (
  sql: SqlClient.SqlClient,
  eventSink: EventSink.EventSinkV2["Service"],
) {
  const rows = yield* sql<LegacyTicketRow>`
      SELECT
        ticket.thread_id,
        ticket.url,
        ticket.key,
        ticket.source,
        ticket.linked_at,
        projection.payload_json
      FROM j_projection_thread_tickets AS ticket
      INNER JOIN orchestration_v2_projection_threads AS projection
        ON projection.thread_id = ticket.thread_id
      WHERE json_type(projection.payload_json, '$.jTickets') IS NULL
      ORDER BY ticket.thread_id ASC, ticket.linked_at ASC, ticket.url ASC
    `;
  const now = yield* DateTime.now;
  let importedThreadCount = 0;
  for (const group of Map.groupBy(rows, (row) => row.thread_id).values()) {
    const threadId = group[0]!.thread_id;
    const stored = decodeStoredThread(group[0]!.payload_json);
    if (Option.isNone(stored)) {
      yield* Effect.logWarning("Skipped V1 ticket links of an undecodable V2 thread", {
        threadId,
      });
      continue;
    }
    const jTickets: Array<JThreadTicket> = [];
    for (const row of group) {
      const ticket = decodeTicket({
        url: row.url,
        key: row.key,
        source: row.source,
        linkedAt: row.linked_at,
      });
      if (Option.isSome(ticket)) {
        jTickets.push(ticket.value);
      } else {
        yield* Effect.logWarning("Skipped an undecodable V1 ticket link", {
          threadId,
          url: row.url,
        });
      }
    }
    const thread: OrchestrationV2AppThread = { ...stored.value, jTickets };
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`migration:v1:thread:${thread.id}:j-tickets:${yield* randomUuidV4}`),
          type: "thread.metadata-updated",
          threadId: thread.id,
          providerInstanceId: thread.providerInstanceId,
          occurredAt: now,
          payload: thread,
        },
      ],
    });
    importedThreadCount += 1;
  }
  return importedThreadCount;
});
