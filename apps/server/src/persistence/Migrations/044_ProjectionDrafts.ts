import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_drafts (
      draft_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      env_mode TEXT NOT NULL,
      start_from_origin INTEGER NOT NULL,
      model_selection_by_provider TEXT NOT NULL,
      active_provider TEXT,
      model_selection_explicit INTEGER NOT NULL,
      device_only_attachment_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_drafts_project_created
    ON projection_drafts(project_id, created_at)
  `;
});
