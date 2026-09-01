import { createDraftEnvironmentAtoms } from "@t3tools/client-runtime/state/drafts";

import { connectionAtomRuntime } from "../connection/runtime";

export const draftEnvironment = createDraftEnvironmentAtoms(connectionAtomRuntime);
