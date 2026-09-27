import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { TicketReference } from "@t3tools/shared/threadTickets";
import { useMemo } from "react";

import { useServerConfigs } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

/** Servers without the fork's ticket links neither send `tickets` nor accept the commands. */
export function useSupportsThreadTickets(environmentId: EnvironmentId | null | undefined): boolean {
  const configs = useServerConfigs();
  return (
    environmentId != null &&
    configs.get(environmentId)?.environment.capabilities.jThreadTickets === true
  );
}

/** Link and unlink actions that throw a displayable error on failure. */
export function useThreadTicketLinking() {
  const link = useAtomCommand(threadEnvironment.linkTicket, { reportFailure: false });
  const unlink = useAtomCommand(threadEnvironment.unlinkTicket, { reportFailure: false });
  return useMemo(() => {
    const settle = async (result: Awaited<ReturnType<typeof link>>) => {
      if (result._tag === "Success") return;
      if (isAtomCommandInterrupted(result)) throw new Error("Link update interrupted.");
      throw squashAtomCommandFailure(result);
    };
    return {
      link: async (threadRef: ScopedThreadRef, ticket: TicketReference) =>
        settle(
          await link({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, ...ticket, source: "manual" },
          }),
        ),
      unlink: async (threadRef: ScopedThreadRef, url: string) =>
        settle(
          await unlink({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, url },
          }),
        ),
    };
  }, [link, unlink]);
}
