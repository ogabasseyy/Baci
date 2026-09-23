import type { CostWindowMeasurement } from './measure-vercel-storefront-cost-types';

function roundMetric(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Builds before/after deltas; non-positive baselines have no relative percent. */
export function compareStorefrontCostWindows(
  before: CostWindowMeasurement,
  after: CostWindowMeasurement | null
) {
  if (!after) return null;
  const values: Record<string, number> = {
    projectEffectiveCostUsd: before.metrics.projectEffectiveCostUsd,
    ...before.metrics.services,
  };
  const afterValues: Record<string, number> = {
    projectEffectiveCostUsd: after.metrics.projectEffectiveCostUsd,
    ...after.metrics.services,
  };
  if (before.dbTrace && after.dbTrace) {
    values.dbCalls = before.dbTrace.dbCalls;
    afterValues.dbCalls = after.dbTrace.dbCalls;
    values.dbTimeouts = before.dbTrace.dbTimeouts;
    afterValues.dbTimeouts = after.dbTrace.dbTimeouts;
    values.dbCallsPerRequest = before.dbTrace.dbCallsPerRequest;
    afterValues.dbCallsPerRequest = after.dbTrace.dbCallsPerRequest;
  }
  if (before.cacheProbe && after.cacheProbe) {
    // Sample sizes are provenance, not performance changes. Compare ratios.
    if (
      before.cacheProbe.cacheHitRatio !== null &&
      after.cacheProbe.cacheHitRatio !== null
    ) {
      values.cacheHitRatio = before.cacheProbe.cacheHitRatio;
      afterValues.cacheHitRatio = after.cacheProbe.cacheHitRatio;
    }
  }
  return Object.fromEntries(
    Object.keys(values).map((metric) => {
      const beforeValue = values[metric];
      const afterValue = afterValues[metric];
      return [
        metric,
        {
          absoluteDelta: roundMetric(afterValue - beforeValue),
          after: afterValue,
          before: beforeValue,
          relativeChangePct:
            beforeValue <= 0
              ? null
              : roundMetric(((afterValue - beforeValue) / beforeValue) * 100),
        },
      ];
    })
  );
}
