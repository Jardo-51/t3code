import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EnvironmentId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * Fork-only: a monthly spending limit, such as a corporate API budget, drawn from the priced usage
 * of chosen provider instances. Names carry the `j` marker (see docs/jardo/forking-strategy.md).
 */
export const JCustomUsageLimitId = Schema.String.pipe(Schema.brand("JCustomUsageLimitId"));
export type JCustomUsageLimitId = typeof JCustomUsageLimitId.Type;

/**
 * Providers on other machines count too, so each one names its environment. The limit is stored
 * on one server, which cannot see the others: clients add up what every connected one reports.
 */
export const JCustomUsageLimitProvider = Schema.Struct({
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId,
});
export type JCustomUsageLimitProvider = typeof JCustomUsageLimitProvider.Type;

/** Spend counts from 00:00 UTC on the 1st of each month, when the limit resets. */
export const JCustomUsageLimit = Schema.Struct({
  name: TrimmedNonEmptyString,
  limitUsd: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  /** Added on top of list prices, e.g. 10 for an endpoint that charges 10% more. */
  markupPercent: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.withDecodingDefault(Effect.succeed(0)),
  ),
  providers: Schema.Array(JCustomUsageLimitProvider),
});
export type JCustomUsageLimit = typeof JCustomUsageLimit.Type;
