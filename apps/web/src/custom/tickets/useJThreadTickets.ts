import type {
  EnvironmentId,
  ExecutionEnvironmentCapabilities,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { MouseEvent } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useServerConfigs } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

export function supportsJThreadTickets(
  capabilities: Pick<ExecutionEnvironmentCapabilities, "jThreadTickets"> | undefined,
): boolean {
  return capabilities?.jThreadTickets === true;
}

export function useJThreadTicketsSupported(
  environmentId: EnvironmentId | null | undefined,
): boolean {
  const configs = useServerConfigs();
  return (
    environmentId != null &&
    supportsJThreadTickets(configs.get(environmentId)?.environment.capabilities)
  );
}

export function useJThreadTicketMutations() {
  const link = useAtomCommand(threadEnvironment.linkTicket, { reportFailure: false });
  const unlink = useAtomCommand(threadEnvironment.unlinkTicket, { reportFailure: false });
  const settle = (result: Awaited<ReturnType<typeof link>>) => {
    if (result._tag === "Success") return;
    if (isAtomCommandInterrupted(result)) throw new Error("Ticket update interrupted.");
    throw squashAtomCommandFailure(result);
  };
  return {
    link: async (threadRef: ScopedThreadRef, url: string, key: string) =>
      settle(
        await link({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, url, key, source: "manual" },
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
}

/** Opens a ticket where the "Open links in" setting says; a modified click on a link stays native. */
export function useOpenTicketLink(threadRef: ScopedThreadRef | null) {
  const openLink = useOpenLink(threadRef);
  return (event: MouseEvent<HTMLElement>, url: string) => {
    if (event.button > 1) return;
    event.stopPropagation();
    const modified = event.metaKey || event.ctrlKey || event.button === 1;
    if (modified && event.currentTarget instanceof HTMLAnchorElement) return;
    event.preventDefault();
    void openLink(url, { event }).catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open ticket link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  };
}
