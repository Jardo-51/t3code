import {
  type EnvironmentId,
  type JCustomUsageLimit,
  type JCustomUsageLimitProvider,
  type ProviderInstanceId,
  type ServerProviderUsageWindow,
  UsageDay,
  type UsageSource,
  type UsageSummary,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** The calendar month in UTC holding `now`, which is the period a custom limit resets on. */
export function jCustomUsageLimitMonth(now: number) {
  const today = DateTime.makeUnsafe(now);
  const start = DateTime.startOf(today, "month");
  const resetsAt = DateTime.add(start, { months: 1 });
  return {
    sinceDay: UsageDay.make(DateTime.formatIsoDateUtc(start)),
    untilDay: UsageDay.make(DateTime.formatIsoDateUtc(today)),
    resetsAt: DateTime.formatIso(resetsAt),
    durationMins: (DateTime.toEpochMillis(resetsAt) - DateTime.toEpochMillis(start)) / 60_000,
  };
}

export interface JCustomUsageLimitProviderSpend {
  readonly provider: JCustomUsageLimitProvider;
  /**
   * Null while the provider's environment has not reported usage for this month, or when it
   * cannot attribute usage to instances.
   */
  readonly spentUsd: number | null;
  /** False when no usage source on the environment is attributed to this instance. */
  readonly hasHistory: boolean;
  /** Instances outside the limit that write to the same history, so their usage counts too. */
  readonly sharedWith: readonly ProviderInstanceId[];
}

export interface JCustomUsageLimitSpend {
  /** Month-to-date spend with the markup applied. */
  readonly spentUsd: number;
  readonly unpricedRecords: number;
  readonly providers: readonly JCustomUsageLimitProviderSpend[];
  readonly missingEnvironmentIds: readonly EnvironmentId[];
  /** Environments that reported, but attribute no usage to instances, such as upstream servers. */
  readonly untrackedEnvironmentIds: readonly EnvironmentId[];
  /** The limit as a monthly window, so it shares pace and reset helpers with provider limits. */
  readonly window: ServerProviderUsageWindow;
}

function sourceKey({ fingerprint }: UsageSource): string {
  return [
    fingerprint.hostId,
    fingerprint.provider,
    fingerprint.resolvedHomePath,
    fingerprint.volumeId,
  ].join("\u0000");
}

/**
 * Adds up month-to-date spend for a limit from each environment's usage summary for
 * `jCustomUsageLimitMonth(now)`. A missing or null summary means that environment has not
 * reported. Two environments on one machine can report the same history, and instances can share
 * one, so each source counts once.
 */
export function jCustomUsageLimitSpend(
  id: string,
  limit: JCustomUsageLimit,
  summaries: ReadonlyMap<EnvironmentId, UsageSummary | null>,
  now: number,
): JCustomUsageLimitSpend {
  const month = jCustomUsageLimitMonth(now);
  const multiplier = 1 + limit.markupPercent / 100;
  const counted = new Set<string>();
  const missing = new Set<EnvironmentId>();
  const untracked = new Set<EnvironmentId>();
  let listPriceUsd = 0;
  let unpricedRecords = 0;

  const providers = limit.providers.map((provider): JCustomUsageLimitProviderSpend => {
    const summary = summaries.get(provider.environmentId) ?? null;
    if (summary === null) {
      missing.add(provider.environmentId);
      return { provider, spentUsd: null, hasHistory: false, sharedWith: [] };
    }
    if (!summary.sources.some((source) => source.jInstanceIds !== undefined)) {
      untracked.add(provider.environmentId);
      return { provider, spentUsd: null, hasHistory: false, sharedWith: [] };
    }
    const selected = new Set(
      limit.providers
        .filter((entry) => entry.environmentId === provider.environmentId)
        .map((entry) => entry.instanceId),
    );
    const sources = summary.sources.filter((source) =>
      source.jInstanceIds?.includes(provider.instanceId),
    );
    const sharedWith = new Set<ProviderInstanceId>();
    let spent = 0;
    for (const source of sources) {
      for (const instanceId of source.jInstanceIds ?? []) {
        if (!selected.has(instanceId)) sharedWith.add(instanceId);
      }
      const key = sourceKey(source);
      if (counted.has(key)) continue;
      counted.add(key);
      for (const bucket of summary.buckets) {
        if (
          bucket.provider !== source.fingerprint.provider ||
          bucket.sourcePath !== source.fingerprint.resolvedHomePath ||
          bucket.day < month.sinceDay ||
          bucket.day > month.untilDay
        ) {
          continue;
        }
        spent += bucket.costUsd;
        unpricedRecords += bucket.unpricedRecords;
      }
    }
    listPriceUsd += spent;
    return {
      provider,
      spentUsd: spent * multiplier,
      hasHistory: sources.length > 0,
      sharedWith: [...sharedWith],
    };
  });

  const spentUsd = listPriceUsd * multiplier;
  return {
    spentUsd,
    unpricedRecords,
    providers,
    missingEnvironmentIds: [...missing],
    untrackedEnvironmentIds: [...untracked],
    window: {
      id,
      kind: "monthly",
      label: limit.name,
      usedPercent: Math.min(100, (spentUsd / limit.limitUsd) * 100),
      resetsAt: month.resetsAt,
      windowDurationMins: month.durationMins,
    },
  };
}
