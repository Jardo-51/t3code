import {
  type EnvironmentId,
  J_CUSTOM_USAGE_LIMIT_DRIVERS,
  type JCustomUsageLimit,
  type JCustomUsageLimitId,
  type JCustomUsageLimitProvider,
  type ServerProvider,
  type UsageSummary,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { resolveUsageAccess } from "@t3tools/client-runtime/state/usage-access";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
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
  /** Whether the environment's server attributes this instance's usage, so a limit can count it. */
  readonly countable: boolean;
}

/** Every provider instance across the connected environments. */
export const jProviderOptionsAtom = Atom.make((get): readonly JProviderOption[] =>
  [...get(environmentPresentations.presentationsWithProvidersAtom)].flatMap(
    ([environmentId, presentation]) => {
      const attributes = presentation.serverConfig?.environment.capabilities.jCustomUsageLimits;
      return (presentation.serverConfig?.providers ?? []).map((server) => {
        const provider = { environmentId, instanceId: server.instanceId };
        return {
          key: jProviderKey(provider),
          provider,
          name:
            server.displayName ?? providerClients.get(server.driver)?.label ?? server.instanceId,
          environmentLabel: presentation.entry.target.label,
          driver: server.driver,
          countable: attributes === true && J_CUSTOM_USAGE_LIMIT_DRIVERS.has(server.driver),
        };
      });
    },
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

export interface JEnvironmentMonthUsage {
  readonly environmentId: EnvironmentId;
  /** Null when this client does not know the environment. */
  readonly label: string | null;
  readonly isPending: boolean;
  readonly canReadDiagnostics: boolean;
  readonly summary: UsageSummary | null;
}

export function jCustomUsageMonthKey(
  input: UsageSummaryInput,
  environmentIds: readonly EnvironmentId[],
): string {
  return JSON.stringify({ input, environmentIds: [...new Set(environmentIds)].toSorted() });
}

/**
 * Usage of only the environments a limit counts. `useUsage` would scan every connected
 * environment for this window, and a cold scan takes seconds per machine.
 */
export const jCustomUsageMonthAtom = Atom.family((key: string) =>
  Atom.make((get): readonly JEnvironmentMonthUsage[] => {
    const { input, environmentIds } = JSON.parse(key) as {
      readonly input: UsageSummaryInput;
      readonly environmentIds: readonly EnvironmentId[];
    };
    return environmentIds.map((environmentId): JEnvironmentMonthUsage => {
      const presentation = get(environmentPresentations.presentationAtom(environmentId));
      if (presentation === null) {
        return {
          environmentId,
          label: null,
          isPending: false,
          canReadDiagnostics: false,
          summary: null,
        };
      }
      const label = presentation.entry.target.label;
      const sessionResult = get(environmentSession.sessionStateAtom(environmentId));
      const access = resolveUsageAccess({
        connectionPhase: presentation.connection.phase,
        session: Option.getOrNull(AsyncResult.value(sessionResult)),
        hasSessionError: sessionResult._tag === "Failure",
      });
      if (!access.canReadDiagnostics) {
        return {
          environmentId,
          label,
          isPending: access.isPending,
          canReadDiagnostics: false,
          summary: null,
        };
      }
      const result = get(serverEnvironment.usageSummary({ environmentId, input }));
      return {
        environmentId,
        label,
        isPending: result.waiting,
        canReadDiagnostics: true,
        summary: Option.getOrNull(AsyncResult.value(result)),
      };
    });
  }).pipe(Atom.withLabel(`web-j-custom-usage-month:${key}`)),
);
