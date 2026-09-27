import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Thread ↔ ticket links. `thread_id` is a plain column, not a foreign key (see the fork rules). */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS j_projection_thread_tickets (
      thread_id TEXT NOT NULL,
      url TEXT NOT NULL,
      key TEXT NOT NULL,
      source TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, url)
    )
  `;
});
