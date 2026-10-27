import type { EnvironmentId, UsageSummaryInput } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { refreshUsage } from "@t3tools/client-runtime/state/usage";
import {
  jCustomUsageLimitMonth,
  jCustomUsageLimitSpend,
  type JCustomUsageLimitSpend,
} from "@t3tools/shared/jCustomUsageLimits";
import { formatCount, formatUsd } from "@t3tools/shared/usageFormat";
import { paceOf } from "@t3tools/shared/usageLimits";
import { WalletIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { PaceIcon, WindowBar, barColor } from "./UsageLimits";
import {
  type JProviderOption,
  type JEnvironmentMonthUsage,
  type JStoredCustomUsageLimit,
  jCustomUsageLimitsAtom,
  jCustomUsageMonthAtom,
  jCustomUsageMonthKey,
  jProviderKey,
  jProviderOptionsAtom,
} from "./jCustomUsageLimitsState";

/**
 * Limits saved on the selected environments. Spend comes from every environment the limits count,
 * since a limit's providers can live on machines the filter leaves out.
 */
export function JCustomUsageLimitsSection({
  selectedEnvironmentIds,
  now,
}: {
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly now: number;
}) {
  const stored = useAtomValue(jCustomUsageLimitsAtom);
  const shown = stored.filter(
    (entry) => selectedEnvironmentIds === null || selectedEnvironmentIds.has(entry.environmentId),
  );
  // Only mounted with limits, so pages without any never scan this month's usage.
  return shown.length === 0 ? null : <JCustomUsageLimitCards limits={shown} now={now} />;
}

function JCustomUsageLimitCards({
  limits,
  now,
}: {
  readonly limits: readonly JStoredCustomUsageLimit[];
  readonly now: number;
}) {
  const { sinceDay, untilDay } = jCustomUsageLimitMonth(now);
  const input: UsageSummaryInput = { sinceDay, untilDay, timeZone: "UTC" };
  const environmentIds = limits.flatMap((entry) =>
    entry.limit.providers.map((provider) => provider.environmentId),
  );
  const environments = useAtomValue(
    jCustomUsageMonthAtom(jCustomUsageMonthKey(input, environmentIds)),
  );
  const options = useAtomValue(jProviderOptionsAtom);
  const refreshMonth = useEffectEvent(() => {
    void refreshUsage({
      registry: appAtomRegistry,
      server: serverEnvironment,
      presentations: environmentPresentations,
      environmentIds: environments
        .filter((environment) => environment.canReadDiagnostics)
        .map(({ environmentId }) => environmentId),
      input,
    });
  });
  // The page advances `now` on refresh. The month summary stays cached for a minute, so without
  // this the spend would lag behind the refreshed pace and reset text.
  const mountedNow = useRef(now);
  useEffect(() => {
    if (now !== mountedNow.current) refreshMonth();
  }, [now]);
  const statuses = new Map(environments.map((status) => [status.environmentId, status]));
  const summaries = new Map(environments.map((status) => [status.environmentId, status.summary]));
  const providers = new Map(options.map((option) => [option.key, option]));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="flex size-5 items-center justify-center">
          <WalletIcon className="size-4 text-foreground/80" aria-hidden />
        </span>
        Custom limits
      </h2>
      {limits.map((entry) => (
        <JCustomUsageLimitCard
          key={`${entry.environmentId}:${entry.id}`}
          entry={entry}
          spend={jCustomUsageLimitSpend(entry.id, entry.limit, summaries, now)}
          statuses={statuses}
          providers={providers}
          now={now}
        />
      ))}
    </section>
  );
}

function JCustomUsageLimitCard({
  entry,
  spend,
  statuses,
  providers,
  now,
}: {
  readonly entry: JStoredCustomUsageLimit;
  readonly spend: JCustomUsageLimitSpend;
  readonly statuses: ReadonlyMap<EnvironmentId, JEnvironmentMonthUsage>;
  readonly providers: ReadonlyMap<string, JProviderOption>;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const { limit } = entry;
  const pace = paceOf(spend.window, now);
  const drivers = new Set(
    limit.providers.flatMap((provider) => providers.get(jProviderKey(provider))?.driver ?? []),
  );
  const [onlyDriver] = drivers;
  const color = drivers.size === 1 && onlyDriver ? barColor(onlyDriver) : "var(--foreground)";
  const providerName = (key: string, fallback: string) => providers.get(key)?.name ?? fallback;
  const environmentLabel = (environmentId: EnvironmentId) =>
    statuses.get(environmentId)?.label ?? "An environment that is not connected";

  const notices: string[] = [];
  for (const environmentId of spend.missingEnvironmentIds) {
    notices.push(
      statuses.get(environmentId)?.isPending
        ? `Waiting for ${environmentLabel(environmentId)} to report usage.`
        : `${environmentLabel(environmentId)} is not reporting usage, so its spend is missing.`,
    );
  }
  for (const environmentId of spend.untrackedEnvironmentIds) {
    notices.push(
      `Usage isn't tracked per provider on ${environmentLabel(environmentId)}, so its spend is missing.`,
    );
  }
  for (const { provider, spentUsd, hasHistory, sharedWith } of spend.providers) {
    const key = jProviderKey(provider);
    const name = providerName(key, provider.instanceId);
    if (spentUsd !== null && !hasHistory) {
      notices.push(
        `${name} has no usage this limit can count on ${environmentLabel(provider.environmentId)}.`,
      );
    }
    if (sharedWith.length > 0) {
      const others = sharedWith
        .map((instanceId) =>
          providerName(
            jProviderKey({ environmentId: provider.environmentId, instanceId }),
            instanceId,
          ),
        )
        .join(", ");
      notices.push(`${name} shares its history with ${others}, so their usage counts too.`);
    }
  }
  if (spend.unpricedRecords > 0) {
    notices.push(
      `${formatCount(spend.unpricedRecords)} request(s) used models without a known price and are not counted.`,
    );
  }

  return (
    <div className="grid items-center gap-x-6 gap-y-3 rounded-lg border border-border/60 p-4 md:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{limit.name}</span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-semibold text-foreground tabular-nums">
            {formatUsd(spend.spentUsd)}
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <span>of {formatUsd(limit.limitUsd)}</span>
            {pace ? <PaceIcon pace={pace} /> : null}
          </span>
        </span>
      </div>
      <WindowBar color={color} window={spend.window} now={now} />
      <div className="flex flex-col gap-1 text-xs text-muted-foreground md:col-span-2">
        <span>
          {limit.markupPercent > 0 ? `Includes +${limit.markupPercent}% markup · ` : ""}
          Resets {formatUpcomingTimestamp(spend.window.resetsAt ?? "", timestampFormat, now)} ·
          Saved on {entry.environmentLabel}
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-0.5">
          {spend.providers.map(({ provider, spentUsd }) => {
            const key = jProviderKey(provider);
            return (
              <span key={key} className="tabular-nums">
                {providerName(key, provider.instanceId)} ·{" "}
                {environmentLabel(provider.environmentId)}{" "}
                <span className="text-foreground">
                  {spentUsd === null ? "—" : formatUsd(spentUsd)}
                </span>
              </span>
            );
          })}
        </span>
        {notices.map((notice) => (
          <span key={notice} className="text-warning-foreground">
            {notice}
          </span>
        ))}
      </div>
    </div>
  );
}
