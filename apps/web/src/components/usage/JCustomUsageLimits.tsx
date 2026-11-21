import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  jCustomUsageLimitSpend,
  type JCustomUsageLimitSpend,
} from "@t3tools/shared/jCustomUsageLimits";
import { formatCount, formatUsd } from "@t3tools/shared/usageFormat";
import { paceOf } from "@t3tools/shared/usageLimits";
import { T, useGT, useLocale, useMessages } from "gt-react";
import { WalletIcon } from "lucide-react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { PaceIcon, WindowBar, barColor } from "./UsageLimits";
import {
  type JProviderOption,
  type JEnvironmentMonthUsage,
  type JStoredCustomUsageLimit,
  jCountedEnvironmentIds,
  jCustomUsageLimitsAtom,
  jCustomUsageMonthAtom,
  jCustomUsageMonthInput,
  jCustomUsageMonthKey,
  jProviderKey,
  jProviderOptionsAtom,
  jShownCustomUsageLimits,
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
  const shown = jShownCustomUsageLimits(
    useAtomValue(jCustomUsageLimitsAtom),
    selectedEnvironmentIds,
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
  const environments = useAtomValue(
    jCustomUsageMonthAtom(
      jCustomUsageMonthKey(jCustomUsageMonthInput(now), jCountedEnvironmentIds(limits)),
    ),
  );
  const options = useAtomValue(jProviderOptionsAtom);
  const statuses = new Map(environments.map((status) => [status.environmentId, status]));
  const summaries = new Map(environments.map((status) => [status.environmentId, status.summary]));
  const providers = new Map(options.map((option) => [option.key, option]));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="flex size-5 items-center justify-center">
          <WalletIcon className="size-4 text-foreground/80" aria-hidden />
        </span>
        <T>Custom limits</T>
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
  const gt = useGT();
  const locale = useLocale();
  const messages = useMessages();
  const { limit } = entry;
  const pace = paceOf(spend.window, now);
  // Until a provider reports, a $0.00 total and its pace would read as nothing spent.
  const reported = spend.providers.some(({ spentUsd }) => spentUsd !== null);
  const drivers = new Set(
    limit.providers.flatMap((provider) => providers.get(jProviderKey(provider))?.driver ?? []),
  );
  const [onlyDriver] = drivers;
  const color = drivers.size === 1 && onlyDriver ? barColor(onlyDriver) : "var(--foreground)";
  const providerName = (key: string, fallback: string) => providers.get(key)?.name ?? fallback;
  // Only used mid-sentence, so the fallback starts lowercase.
  const environmentLabel = (environmentId: EnvironmentId) =>
    statuses.get(environmentId)?.label ??
    gt("an environment that is not connected", { $context: "used mid-sentence" });

  // Keyed by what they are about: two unknown environments share a label, so texts can repeat.
  const notices: { readonly key: string; readonly text: string }[] = [];
  for (const environmentId of spend.missingEnvironmentIds) {
    notices.push({
      key: `missing:${environmentId}`,
      text: statuses.get(environmentId)?.isPending
        ? gt("Waiting for {environment} to report usage.", {
            environment: environmentLabel(environmentId),
          })
        : gt("Spend from {environment} is missing, as it is not reporting usage.", {
            environment: environmentLabel(environmentId),
          }),
    });
  }
  for (const environmentId of spend.untrackedEnvironmentIds) {
    notices.push({
      key: `untracked:${environmentId}`,
      text: gt("Usage isn't tracked per provider on {environment}, so its spend is missing.", {
        environment: environmentLabel(environmentId),
      }),
    });
  }
  const sharedGroups = new Set<string>();
  for (const { provider, sharedWithChosen } of spend.providers) {
    if (sharedWithChosen.length === 0) continue;
    const group = [provider, ...sharedWithChosen].toSorted((a, b) =>
      jProviderKey(a).localeCompare(jProviderKey(b)),
    );
    const groupKey = group.map(jProviderKey).join("\n");
    if (sharedGroups.has(groupKey)) continue;
    sharedGroups.add(groupKey);
    const acrossEnvironments = group.some(
      (member) => member.environmentId !== provider.environmentId,
    );
    const names = group.map((member) => {
      const name = providerName(jProviderKey(member), member.instanceId);
      return acrossEnvironments
        ? gt("{provider} on {environment}", {
            provider: name,
            environment: environmentLabel(member.environmentId),
          })
        : name;
    });
    notices.push({
      key: `chosen:${groupKey}`,
      text: gt("{providers} read one history, so it counts once towards the total.", {
        providers: new Intl.ListFormat(locale).format(names),
      }),
    });
  }
  for (const { provider, spentUsd, hasHistory, sharedWith } of spend.providers) {
    const key = jProviderKey(provider);
    const name = providerName(key, provider.instanceId);
    if (spentUsd !== null && !hasHistory) {
      notices.push({
        key: `history:${key}`,
        text: gt("{provider} has no usage this limit can count on {environment}.", {
          provider: name,
          environment: environmentLabel(provider.environmentId),
        }),
      });
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
      notices.push({
        key: `shared:${key}`,
        text: gt("{provider} shares its history with {others}, so their usage counts too.", {
          provider: name,
          others,
        }),
      });
    }
  }
  if (spend.unpricedRecords > 0) {
    notices.push({
      key: "unpriced",
      text: gt(
        "{count, plural, one {{formatted} request used a model without a known price and is not counted.} other {{formatted} requests used models without a known price and are not counted.}}",
        { count: spend.unpricedRecords, formatted: formatCount(spend.unpricedRecords) },
      ),
    });
  }

  return (
    <div className="grid items-center gap-x-6 gap-y-3 rounded-lg border border-border/60 p-4 md:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{limit.name}</span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-semibold text-foreground tabular-nums">
            {reported ? formatUsd(spend.spentUsd) : "-"}
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <span>{gt("of {amount}", { amount: formatUsd(limit.limitUsd) })}</span>
            {reported && pace ? <PaceIcon pace={pace} /> : null}
          </span>
        </span>
      </div>
      <WindowBar color={color} window={spend.window} now={now} />
      <div className="flex flex-col gap-1 text-xs text-muted-foreground md:col-span-2">
        <span>
          {limit.markupPercent > 0
            ? `${gt("Includes +{percent}% markup", { percent: limit.markupPercent })} · `
            : ""}
          {gt("Resets {time}", {
            time: formatUpcomingTimestamp(
              spend.window.resetsAt ?? "",
              timestampFormat,
              now,
              undefined,
              messages,
            ),
          })}{" "}
          · {gt("Saved on {environment}", { environment: entry.environmentLabel })}
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-0.5">
          {spend.providers.map(({ provider, spentUsd }) => {
            const key = jProviderKey(provider);
            return (
              <span key={key} className="tabular-nums">
                {providerName(key, provider.instanceId)} ·{" "}
                {statuses.get(provider.environmentId)?.label ?? gt("Not connected")}{" "}
                <span className="text-foreground">
                  {spentUsd === null ? "-" : formatUsd(spentUsd)}
                </span>
              </span>
            );
          })}
        </span>
        {notices.map((notice) => (
          <span key={notice.key} className="text-warning-foreground">
            {notice.text}
          </span>
        ))}
      </div>
    </div>
  );
}
