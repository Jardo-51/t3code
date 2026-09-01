import { DraftId, OrchestrationDraft, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../Errors.ts";

/**
 * Drafts project one row per unsent draft, which is also the whole record:
 * unlike a thread there is no message, activity or checkpoint history to fan
 * out into sibling tables.
 */
export const ProjectionDraft = OrchestrationDraft;
export type ProjectionDraft = typeof ProjectionDraft.Type;

export const GetProjectionDraftInput = Schema.Struct({
  draftId: DraftId,
});
export type GetProjectionDraftInput = typeof GetProjectionDraftInput.Type;

export const DeleteProjectionDraftInput = Schema.Struct({
  draftId: DraftId,
});
export type DeleteProjectionDraftInput = typeof DeleteProjectionDraftInput.Type;

export const DeleteProjectionDraftsByProjectIdInput = Schema.Struct({
  projectId: ProjectId,
});
export type DeleteProjectionDraftsByProjectIdInput =
  typeof DeleteProjectionDraftsByProjectIdInput.Type;

export interface ProjectionDraftRepositoryShape {
  readonly upsert: (draft: ProjectionDraft) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionDraftInput,
  ) => Effect.Effect<Option.Option<ProjectionDraft>, ProjectionRepositoryError>;
  readonly list: () => Effect.Effect<ReadonlyArray<ProjectionDraft>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteProjectionDraftInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Drafts die with their project: nothing can start a turn for them again. */
  readonly deleteByProjectId: (
    input: DeleteProjectionDraftsByProjectIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionDraftRepository extends Context.Service<
  ProjectionDraftRepository,
  ProjectionDraftRepositoryShape
>()("t3/persistence/Services/ProjectionDrafts/ProjectionDraftRepository") {}
