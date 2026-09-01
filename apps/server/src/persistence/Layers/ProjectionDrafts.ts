import { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionDraftInput,
  DeleteProjectionDraftsByProjectIdInput,
  GetProjectionDraftInput,
  ProjectionDraft,
  ProjectionDraftRepository,
  type ProjectionDraftRepositoryShape,
} from "../Services/ProjectionDrafts.ts";

// SQLite has no boolean or object columns: flags round-trip as 0/1 and the
// per-instance model selections as one JSON document.
const ProjectionDraftDbRowSchema = ProjectionDraft.mapFields(
  Struct.assign({
    startFromOrigin: Schema.Number,
    modelSelectionExplicit: Schema.Number,
    modelSelectionByProvider: Schema.fromJsonString(
      Schema.Record(ProviderInstanceId, ModelSelection),
    ),
  }),
);

function toProjectionDraft(
  row: Schema.Schema.Type<typeof ProjectionDraftDbRowSchema>,
): ProjectionDraft {
  return {
    ...row,
    startFromOrigin: row.startFromOrigin === 1,
    modelSelectionExplicit: row.modelSelectionExplicit === 1,
  };
}

const makeProjectionDraftRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionDraftRow = SqlSchema.void({
    Request: ProjectionDraftDbRowSchema,
    execute: (row) => sql`
      INSERT INTO projection_drafts (
        draft_id,
        project_id,
        thread_id,
        prompt,
        runtime_mode,
        interaction_mode,
        branch,
        worktree_path,
        env_mode,
        start_from_origin,
        model_selection_by_provider,
        active_provider,
        model_selection_explicit,
        device_only_attachment_count,
        created_at,
        updated_at
      )
      VALUES (
        ${row.id},
        ${row.projectId},
        ${row.threadId},
        ${row.prompt},
        ${row.runtimeMode},
        ${row.interactionMode},
        ${row.branch},
        ${row.worktreePath},
        ${row.envMode},
        ${row.startFromOrigin},
        ${row.modelSelectionByProvider},
        ${row.activeProvider},
        ${row.modelSelectionExplicit},
        ${row.deviceOnlyAttachmentCount},
        ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (draft_id)
      DO UPDATE SET
        project_id = excluded.project_id,
        thread_id = excluded.thread_id,
        prompt = excluded.prompt,
        runtime_mode = excluded.runtime_mode,
        interaction_mode = excluded.interaction_mode,
        branch = excluded.branch,
        worktree_path = excluded.worktree_path,
        env_mode = excluded.env_mode,
        start_from_origin = excluded.start_from_origin,
        model_selection_by_provider = excluded.model_selection_by_provider,
        active_provider = excluded.active_provider,
        model_selection_explicit = excluded.model_selection_explicit,
        device_only_attachment_count = excluded.device_only_attachment_count,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= projection_drafts.updated_at
    `,
  });

  const getProjectionDraftRow = SqlSchema.findOneOption({
    Request: GetProjectionDraftInput,
    Result: ProjectionDraftDbRowSchema,
    execute: ({ draftId }) => sql`
      SELECT
        draft_id AS "id",
        project_id AS "projectId",
        thread_id AS "threadId",
        prompt,
        runtime_mode AS "runtimeMode",
        interaction_mode AS "interactionMode",
        branch,
        worktree_path AS "worktreePath",
        env_mode AS "envMode",
        start_from_origin AS "startFromOrigin",
        model_selection_by_provider AS "modelSelectionByProvider",
        active_provider AS "activeProvider",
        model_selection_explicit AS "modelSelectionExplicit",
        device_only_attachment_count AS "deviceOnlyAttachmentCount",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_drafts
      WHERE draft_id = ${draftId}
    `,
  });

  const listProjectionDraftRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionDraftDbRowSchema,
    execute: () => sql`
      SELECT
        draft_id AS "id",
        project_id AS "projectId",
        thread_id AS "threadId",
        prompt,
        runtime_mode AS "runtimeMode",
        interaction_mode AS "interactionMode",
        branch,
        worktree_path AS "worktreePath",
        env_mode AS "envMode",
        start_from_origin AS "startFromOrigin",
        model_selection_by_provider AS "modelSelectionByProvider",
        active_provider AS "activeProvider",
        model_selection_explicit AS "modelSelectionExplicit",
        device_only_attachment_count AS "deviceOnlyAttachmentCount",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_drafts
      ORDER BY created_at ASC, draft_id ASC
    `,
  });

  const deleteProjectionDraftRow = SqlSchema.void({
    Request: DeleteProjectionDraftInput,
    execute: ({ draftId }) => sql`
      DELETE FROM projection_drafts
      WHERE draft_id = ${draftId}
    `,
  });

  const deleteProjectionDraftRowsByProjectId = SqlSchema.void({
    Request: DeleteProjectionDraftsByProjectIdInput,
    execute: ({ projectId }) => sql`
      DELETE FROM projection_drafts
      WHERE project_id = ${projectId}
    `,
  });

  const upsert: ProjectionDraftRepositoryShape["upsert"] = (draft) =>
    upsertProjectionDraftRow({
      ...draft,
      startFromOrigin: draft.startFromOrigin ? 1 : 0,
      modelSelectionExplicit: draft.modelSelectionExplicit ? 1 : 0,
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionDraftRepository.upsert:query")));

  const getById: ProjectionDraftRepositoryShape["getById"] = (input) =>
    getProjectionDraftRow(input).pipe(
      Effect.map(Option.map(toProjectionDraft)),
      Effect.mapError(toPersistenceSqlError("ProjectionDraftRepository.getById:query")),
    );

  const list: ProjectionDraftRepositoryShape["list"] = () =>
    listProjectionDraftRows().pipe(
      Effect.map((rows) => rows.map(toProjectionDraft)),
      Effect.mapError(toPersistenceSqlError("ProjectionDraftRepository.list:query")),
    );

  const deleteById: ProjectionDraftRepositoryShape["deleteById"] = (input) =>
    deleteProjectionDraftRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDraftRepository.deleteById:query")),
    );

  const deleteByProjectId: ProjectionDraftRepositoryShape["deleteByProjectId"] = (input) =>
    deleteProjectionDraftRowsByProjectId(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDraftRepository.deleteByProjectId:query")),
    );

  return {
    upsert,
    getById,
    list,
    deleteById,
    deleteByProjectId,
  } satisfies ProjectionDraftRepositoryShape;
});

export const ProjectionDraftRepositoryLive = Layer.effect(
  ProjectionDraftRepository,
  makeProjectionDraftRepository,
);
