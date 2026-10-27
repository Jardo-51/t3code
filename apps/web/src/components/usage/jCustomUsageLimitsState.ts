import type {
  EnvironmentId,
  JCustomUsageLimit,
  JCustomUsageLimitId,
  JCustomUsageLimitProvider,
  ServerProvider,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { providerClients } from "../settings/providerDriverMeta";

export function jProviderKey(provider: JCustomUsageLimitProvider): string {
  return `${provider.environmentId}:${provider.instanceId}`;
}

export interface JProviderOption {
  readonly key: string;
  readonly provider: JCustomUsageLimitProvider;
  readonly name: string;
  readonly environmentLabel: string;
  readonly driver: ServerProvider["driver"];
}

/** Every provider instance a limit can count, across the connected environments. */
export const jProviderOptionsAtom = Atom.make((get): readonly JProviderOption[] =>
  [...get(environmentPresentations.presentationsWithProvidersAtom)].flatMap(
    ([environmentId, presentation]) =>
      (presentation.serverConfig?.providers ?? []).map((server) => {
        const provider = { environmentId, instanceId: server.instanceId };
        return {
          key: jProviderKey(provider),
          provider,
          name:
            server.displayName ?? providerClients.get(server.driver)?.label ?? server.instanceId,
          environmentLabel: presentation.entry.target.label,
          driver: server.driver,
        };
      }),
  ),
).pipe(Atom.withLabel("web-j-custom-usage-limit-providers"));

export interface JStoredCustomUsageLimit {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly id: JCustomUsageLimitId;
  readonly limit: JCustomUsageLimit;
}

/** The limits saved in each environment's settings, on servers that keep them. */
export const jCustomUsageLimitsAtom = Atom.make((get): readonly JStoredCustomUsageLimit[] =>
  [...get(environmentPresentations.presentationsWithProvidersAtom)].flatMap(
    ([environmentId, presentation]) => {
      if (presentation.serverConfig?.environment.capabilities.jCustomUsageLimits !== true) {
        return [];
      }
      const limits = get(serverEnvironment.settingsValueAtom(environmentId))?.jCustomUsageLimits;
      return Object.entries(limits ?? {}).map(([id, limit]) => ({
        environmentId,
        environmentLabel: presentation.entry.target.label,
        id: id as JCustomUsageLimitId,
        limit,
      }));
    },
  ),
).pipe(Atom.withLabel("web-j-custom-usage-limits"));
