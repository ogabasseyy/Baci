import { describe, expect, it } from 'vitest';
import { areDbTracesComparable } from './are-db-traces-comparable';
import type {
  CostWindowMeasurement,
  MetricName,
  StorefrontDbTraceMetrics,
} from './measure-vercel-storefront-cost-types';
import { SERVICE_METRICS } from './measure-vercel-storefront-cost-types';

function emptyServices(): Record<MetricName, number> {
  return Object.fromEntries(
    Object.values(SERVICE_METRICS).map((metric) => [metric, 0])
  ) as Record<MetricName, number>;
}

function windowWithTrace(
  byCohort: StorefrontDbTraceMetrics['byCohort'],
  rows: number
): CostWindowMeasurement {
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
      projectEffectiveCostUsd: 1,
      services: emptyServices(),
    },
    dbTrace: {
      byCohort,
      dbCalls: 1,
      dbCallsPerRequest: 1,
      dbTimeoutRate: null,
      dbTimeouts: 0,
      rows,
      sourceSha256: 'c'.repeat(64),
    },
  };
}

describe('bugfix: reversed cohort mix looked comparable', () => {
  it('rejects unlabeled samples even when their counts match', () => {
    const sample = windowWithTrace(
      {
        unknown: {
          rows: 1,
          dbCalls: 1,
          dbCallsPerRequest: 1,
          dbTimeouts: 0,
          dbTimeoutRate: 0,
        },
      },
      1
    );
    expect(areDbTracesComparable(sample, sample)).toBe(false);
  });

  it('accepts matching explicit cohorts and rejects missing traces', () => {
    const sample = windowWithTrace(
      {
        pdp: {
          rows: 1,
          dbCalls: 1,
          dbCallsPerRequest: 1,
          dbTimeouts: 0,
          dbTimeoutRate: 0,
        },
      },
      1
    );
    expect(areDbTracesComparable(sample, sample)).toBe(true);
    expect(
      areDbTracesComparable(sample, { ...sample, dbTrace: undefined })
    ).toBe(false);
  });
  it('returns false when totals match but per-cohort rows differ', () => {
    const before = windowWithTrace(
      {
        blog: {
          dbCalls: 1,
          dbCallsPerRequest: 1,
          dbTimeoutRate: null,
          dbTimeouts: 0,
          rows: 1,
        },
        pdp: {
          dbCalls: 99,
          dbCallsPerRequest: 1,
          dbTimeoutRate: null,
          dbTimeouts: 0,
          rows: 99,
        },
      },
      100
    );
    const after = windowWithTrace(
      {
        blog: {
          dbCalls: 99,
          dbCallsPerRequest: 1,
          dbTimeoutRate: null,
          dbTimeouts: 0,
          rows: 99,
        },
        pdp: {
          dbCalls: 1,
          dbCallsPerRequest: 1,
          dbTimeoutRate: null,
          dbTimeouts: 0,
          rows: 1,
        },
      },
      100
    );
    expect(areDbTracesComparable(before, after)).toBe(false);
  });
});
