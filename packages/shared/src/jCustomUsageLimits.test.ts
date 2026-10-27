import {
  type EnvironmentId,
  type JCustomUsageLimit,
  ProviderInstanceId,
  type UsageBucket,
  type UsageDay,
  type UsageSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { jCustomUsageLimitMonth, jCustomUsageLimitSpend } from "./jCustomUsageLimits.ts";
import { paceRemainingPercent } from "./usageLimits.ts";

const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const LAPTOP = "laptop" as EnvironmentId;
const DESKTOP = "desktop" as EnvironmentId;
const work = ProviderInstanceId.make("claude-work");
const personal = ProviderInstanceId.make("claudeAgent");

function bucket(day: string, sourcePath: string, costUsd: number, unpricedRecords = 0) {
  return {
    day: day as UsageDay,
    provider: "claude",
    model: "claude-fable-5",
    sourcePath,
    totals: {
      uncachedInputTokens: 1,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
    },
    costUsd,
    cacheSavingsUsd: 0,
    costSource: "modelPriced",
    records: 1,
    unpricedRecords,
    sessions: 1,
  } satisfies UsageBucket;
}

function summary(
  hostId: string,
  sources: ReadonlyArray<{ readonly dir: string; readonly instanceIds?: ProviderInstanceId[] }>,
  buckets: readonly UsageBucket[],
): UsageSummary {
  return {
    contractVersion: 6,
    readAt: "2026-10-16T12:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-10-01" as UsageDay,
    untilDay: "2026-10-16" as UsageDay,
    buckets,
    sources: sources.map(({ dir, instanceIds }) => ({
      fingerprint: { hostId, provider: "claude", resolvedHomePath: dir, volumeId: "vol" },
      status: "ok",
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: 1,
      message: null,
      ...(instanceIds === undefined ? {} : { jInstanceIds: instanceIds }),
    })),
    pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 1 },
    scanDurationMs: 1,
  };
}

function limit(providers: JCustomUsageLimit["providers"]): JCustomUsageLimit {
  return { name: "Corporate API", limitUsd: 1000, markupPercent: 10, providers };
}

describe("jCustomUsageLimitMonth", () => {
  it("spans the UTC calendar month and resets on the 1st", () => {
    expect(jCustomUsageLimitMonth(Date.parse("2026-02-28T23:30:00.000-05:00"))).toEqual({
      sinceDay: "2026-03-01",
      untilDay: "2026-03-01",
      resetsAt: "2026-04-01T00:00:00.000Z",
      durationMins: 31 * 24 * 60,
    });
  });
});

describe("jCustomUsageLimitSpend", () => {
  it("adds the markup to this month's spend of the chosen instances on every environment", () => {
    const spend = jCustomUsageLimitSpend(
      "corp",
      limit([
        { environmentId: LAPTOP, instanceId: work },
        { environmentId: DESKTOP, instanceId: work },
      ]),
      new Map([
        [
          LAPTOP,
          summary(
            "laptop",
            [
              { dir: "/l/work", instanceIds: [work] },
              { dir: "/l/personal", instanceIds: [personal] },
            ],
            [
              bucket("2026-09-30", "/l/work", 500),
              bucket("2026-10-02", "/l/work", 100),
              bucket("2026-10-03", "/l/personal", 900),
            ],
          ),
        ],
        [
          DESKTOP,
          summary(
            "desktop",
            [{ dir: "/d/work", instanceIds: [work] }],
            [bucket("2026-10-10", "/d/work", 200, 3)],
          ),
        ],
      ]),
      NOW,
    );

    expect(spend.spentUsd).toBeCloseTo(330);
    expect(spend.providers.map((provider) => provider.spentUsd)).toEqual([
      expect.closeTo(110),
      expect.closeTo(220),
    ]);
    expect(spend.unpricedRecords).toBe(3);
    expect(spend.window.usedPercent).toBeCloseTo(33);
    expect(spend.window.resetsAt).toBe("2026-11-01T00:00:00.000Z");
    expect(paceRemainingPercent(spend.window, NOW)).toBe(50);
  });

  it("counts a history once when two environments on one machine report it", () => {
    const shared = summary(
      "laptop",
      [{ dir: "/l/work", instanceIds: [work] }],
      [bucket("2026-10-02", "/l/work", 100)],
    );
    const spend = jCustomUsageLimitSpend(
      "corp",
      limit([
        { environmentId: LAPTOP, instanceId: work },
        { environmentId: DESKTOP, instanceId: work },
      ]),
      new Map([
        [LAPTOP, shared],
        [DESKTOP, shared],
      ]),
      NOW,
    );
    expect(spend.spentUsd).toBeCloseTo(110);
  });

  it("shows a history shared by two chosen instances on both rows and counts it once", () => {
    const spend = jCustomUsageLimitSpend(
      "corp",
      limit([
        { environmentId: LAPTOP, instanceId: work },
        { environmentId: LAPTOP, instanceId: personal },
      ]),
      new Map([
        [
          LAPTOP,
          summary(
            "laptop",
            [{ dir: "/l/claude", instanceIds: [work, personal] }],
            [bucket("2026-10-02", "/l/claude", 100, 2)],
          ),
        ],
      ]),
      NOW,
    );
    expect(spend.spentUsd).toBeCloseTo(110);
    expect(spend.unpricedRecords).toBe(2);
    expect(
      spend.providers.map(({ spentUsd, sharedWith, sharedWithChosen }) => ({
        spentUsd,
        sharedWith,
        sharedWithChosen,
      })),
    ).toEqual([
      {
        spentUsd: expect.closeTo(110),
        sharedWith: [],
        sharedWithChosen: [{ environmentId: LAPTOP, instanceId: personal }],
      },
      {
        spentUsd: expect.closeTo(110),
        sharedWith: [],
        sharedWithChosen: [{ environmentId: LAPTOP, instanceId: work }],
      },
    ]);
  });

  it("names instances outside the limit that share a chosen instance's history", () => {
    const spend = jCustomUsageLimitSpend(
      "corp",
      limit([{ environmentId: LAPTOP, instanceId: work }]),
      new Map([
        [
          LAPTOP,
          summary(
            "laptop",
            [{ dir: "/l/claude", instanceIds: [personal, work] }],
            [bucket("2026-10-02", "/l/claude", 100)],
          ),
        ],
      ]),
      NOW,
    );
    expect(spend.providers[0]?.sharedWith).toEqual([personal]);
    expect(spend.spentUsd).toBeCloseTo(110);
  });

  it("reports environments that have not answered and instances without history", () => {
    const spend = jCustomUsageLimitSpend(
      "corp",
      limit([
        { environmentId: LAPTOP, instanceId: work },
        { environmentId: DESKTOP, instanceId: work },
      ]),
      new Map([[LAPTOP, summary("laptop", [{ dir: "/l/personal", instanceIds: [personal] }], [])]]),
      NOW,
    );
    expect(spend.missingEnvironmentIds).toEqual([DESKTOP]);
    expect(spend.providers.map(({ spentUsd, hasHistory }) => ({ spentUsd, hasHistory }))).toEqual([
      { spentUsd: 0, hasHistory: false },
      { spentUsd: null, hasHistory: false },
    ]);
  });

  it("leaves out environments that do not attribute usage to instances", () => {
    const spend = jCustomUsageLimitSpend(
      "corp",
      limit([
        { environmentId: LAPTOP, instanceId: work },
        { environmentId: DESKTOP, instanceId: work },
      ]),
      new Map([
        [
          LAPTOP,
          summary(
            "laptop",
            [{ dir: "/l/work", instanceIds: [work] }],
            [bucket("2026-10-05", "/l/work", 100)],
          ),
        ],
        [
          DESKTOP,
          summary("desktop", [{ dir: "/d/claude" }], [bucket("2026-10-05", "/d/claude", 40)]),
        ],
      ]),
      NOW,
    );
    expect(spend.untrackedEnvironmentIds).toEqual([DESKTOP]);
    expect(spend.missingEnvironmentIds).toEqual([]);
    expect(spend.providers[1]).toMatchObject({ spentUsd: null, hasHistory: false });
    expect(spend.spentUsd).toBeCloseTo(110);
  });

  it("caps the bar at a full limit while keeping the overspent amount", () => {
    const spend = jCustomUsageLimitSpend(
      "corp",
      { ...limit([{ environmentId: LAPTOP, instanceId: work }]), limitUsd: 50 },
      new Map([
        [
          LAPTOP,
          summary(
            "laptop",
            [{ dir: "/l/work", instanceIds: [work] }],
            [bucket("2026-10-02", "/l/work", 100)],
          ),
        ],
      ]),
      NOW,
    );
    expect(spend.spentUsd).toBeCloseTo(110);
    expect(spend.window.usedPercent).toBe(100);
  });
});
