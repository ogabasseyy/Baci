import { describe, expect, it } from 'vitest';
import { compareStorefrontCostWindows } from './compare-storefront-cost-windows';
import {
  type CostWindowMeasurement,
  type MetricName,
  SERVICE_METRICS,
} from './measure-vercel-storefront-cost-types';

function emptyServices(): Record<MetricName, number> {
  return Object.fromEntries(
    Object.values(SERVICE_METRICS).map((metric) => [metric, 0])
  ) as Record<MetricName, number>;
}

function window(overrides: {
  projectEffectiveCostUsd: number;
}): CostWindowMeasurement {
  return {
    deploymentSha: 'a'.repeat(40),
    ignoredRows: 0,
    label: 'window',
    projectId: 'prj_test',
    sourceSha256: 'b'.repeat(64),
    totalRows: 1,
    observedChargePeriod: {
      end: '2026-08-02T00:00:00.000Z',
      start: '2026-08-01T00:00:00.000Z',
    },
    metrics: {
      projectEffectiveCostUsd: overrides.projectEffectiveCostUsd,
      services: emptyServices(),
    },
  };
}

describe('compareStorefrontCostWindows', () => {
  it('returns null when after is missing', () => {
    expect(
      compareStorefrontCostWindows(window({ projectEffectiveCostUsd: 1 }), null)
    ).toBeNull();
  });

  it('bugfix: suppresses relative percentages when baseline cost is non-positive', () => {
    const comparison = compareStorefrontCostWindows(
      window({ projectEffectiveCostUsd: -1 }),
      window({ projectEffectiveCostUsd: 0 })
    );

    expect(comparison?.projectEffectiveCostUsd).toEqual({
      absoluteDelta: 1,
      after: 0,
      before: -1,
      relativeChangePct: null,
    });
  });

  it('computes relative percentages for positive baselines', () => {
    const comparison = compareStorefrontCostWindows(
      window({ projectEffectiveCostUsd: 10 }),
      window({ projectEffectiveCostUsd: 8 })
    );

    expect(comparison?.projectEffectiveCostUsd).toEqual({
      absoluteDelta: -2,
      after: 8,
      before: 10,
      relativeChangePct: -20,
    });
  });
});
