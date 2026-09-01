import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";

import { createAtomCommandScheduler, createEnvironmentCommand } from "./runtime.ts";
import {
  type DiscardDraftInput,
  type UpsertDraftInput,
  discardDraft,
  upsertDraft,
} from "../operations/commands.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export type { DiscardDraftInput, UpsertDraftInput } from "../operations/commands.ts";

export function createDraftEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  // Serialized per draft so a burst of edits reaches the server in the order
  // it was typed. Without this, two in-flight writes for one draft could land
  // out of order and the newer text would lose to the older one.
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { draftId: string } }) =>
      JSON.stringify([environmentId, input.draftId]),
  };
  return {
    upsert: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:draft:upsert",
      execute: (input: UpsertDraftInput) => upsertDraft(input),
      scheduler,
      concurrency,
    }),
    discard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:draft:discard",
      execute: (input: DiscardDraftInput) => discardDraft(input),
      scheduler,
      concurrency,
    }),
  };
}
