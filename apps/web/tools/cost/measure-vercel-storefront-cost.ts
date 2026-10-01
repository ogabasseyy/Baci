import { createHash } from 'node:crypto';
import { areDbTracesComparable } from './are-db-traces-comparable';
import { compareStorefrontCostWindows } from './compare-storefront-cost-windows';
import { finiteNonnegative } from './finite-nonnegative';
import { finiteSigned } from './finite-signed';
import { dateString } from './focus-billing-date-string';
import {
  type CostWindowMeasurement,
  type MetricName,
  SERVICE_CONSUMED_UNITS,
  SERVICE_METRICS,
  type ServiceName,
  type StorefrontCostMeasurement,
  type WindowOptions,
} from './measure-vercel-storefront-cost-types';
import { readBoundedJsonl } from './read-bounded-jsonl';
import { summarizeCacheProbe } from './summarize-cache-probe';
import { summarizeStorefrontDbTraces } from './summarize-storefront-db-traces';

const PROJECT_TAG = 'ProjectId';
type FocusRow = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function comparableWindowDurationMs(window: {
  observedChargePeriod: { end: string; start: string };
  requestedWindow?: { end: string; start: string };
}) {
  const bounds = window.requestedWindow ?? window.observedChargePeriod;
  return Date.parse(bounds.end) - Date.parse(bounds.start);
}

function withoutDbTrace(window: CostWindowMeasurement): CostWindowMeasurement {
  if (!window.dbTrace) return window;
  const { dbTrace: _dbTrace, ...rest } = window;
  return rest;
}

function roundMetric(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function emptyServices(): Record<MetricName, number> {
  return Object.fromEntries(
    Object.values(SERVICE_METRICS).map((metric) => [metric, 0])
  ) as Record<MetricName, number>;
}

function readProjectId(row: FocusRow) {
  if (!isRecord(row.Tags)) return undefined;
  const value = row.Tags[PROJECT_TAG];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error('billing row has a non-string ProjectId tag');
  }
  return value;
}

function assertSafeAggregate(total: number, field: string) {
  if (!Number.isFinite(total) || Math.abs(total) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`billing export ${field} total is out of safe range`);
  }
}

async function summarizeBillingWindow(
  path: string,
  projectId: string,
  options: WindowOptions
): Promise<CostWindowMeasurement> {
  if (!projectId.trim()) throw new Error('projectId is required');
  if (!/^[a-f0-9]{40}$/i.test(options.deploymentSha))
    throw new Error('deploymentSha must be a 40-character Git SHA');
  const { bytes, rows } = await readBoundedJsonl(path, 'billing export');
  const services = emptyServices();
  let projectEffectiveCostUsd = 0;
  let ignoredRows = 0;
  let observedStart = '';
  let observedEnd = '';
  const hasRequestedWindowStart = Boolean(options.requestedWindowStart);
  const hasRequestedWindowEnd = Boolean(options.requestedWindowEnd);
  if (hasRequestedWindowStart !== hasRequestedWindowEnd) {
    throw new Error('requested billing window requires both start and end');
  }
  const requestedWindow =
    hasRequestedWindowStart && hasRequestedWindowEnd
      ? {
          start: dateString(
            options.requestedWindowStart,
            'requestedWindowStart'
          ),
          end: dateString(options.requestedWindowEnd, 'requestedWindowEnd'),
        }
      : undefined;
  if (
    requestedWindow &&
    Date.parse(requestedWindow.end) <= Date.parse(requestedWindow.start)
  )
    throw new Error('requested billing window must be positive');
  for (const candidate of rows) {
    if (!isRecord(candidate)) throw new Error('billing row is not an object');
    const row = candidate;
    const start = dateString(row.ChargePeriodStart, 'ChargePeriodStart');
    const end = dateString(row.ChargePeriodEnd, 'ChargePeriodEnd');
    if (Date.parse(end) <= Date.parse(start))
      throw new Error('billing row has a non-positive charge period');
    const effectiveCost = finiteSigned(row.EffectiveCost, 'EffectiveCost');
    const quantity = finiteNonnegative(
      row.ConsumedQuantity,
      'ConsumedQuantity'
    );
    if (readProjectId(row) !== projectId) {
      ignoredRows += 1;
      continue;
    }
    if (
      requestedWindow &&
      (start < requestedWindow.start || end > requestedWindow.end)
    ) {
      throw new Error(
        'billing row ChargePeriod falls outside the requested window'
      );
    }
    const currency = row.BillingCurrency;
    if (typeof currency !== 'string' || currency.toUpperCase() !== 'USD') {
      throw new Error('billing row has a non-USD BillingCurrency');
    }
    projectEffectiveCostUsd += effectiveCost;
    assertSafeAggregate(projectEffectiveCostUsd, 'EffectiveCost');
    observedStart =
      !observedStart || start < observedStart ? start : observedStart;
    observedEnd = !observedEnd || end > observedEnd ? end : observedEnd;
    const serviceName =
      typeof row.ServiceName === 'string' ? row.ServiceName : undefined;
    const metric =
      serviceName && Object.hasOwn(SERVICE_METRICS, serviceName)
        ? SERVICE_METRICS[serviceName as ServiceName]
        : undefined;
    if (metric) {
      const expectedUnit = SERVICE_CONSUMED_UNITS[serviceName as ServiceName];
      const consumedUnit = row.ConsumedUnit;
      if (typeof consumedUnit !== 'string' || consumedUnit !== expectedUnit) {
        throw new Error(
          `billing row has an unexpected ConsumedUnit for ${serviceName}`
        );
      }
      services[metric] += quantity;
      assertSafeAggregate(services[metric], metric);
    }
  }
  if (!observedStart || !observedEnd)
    throw new Error(`billing export has no rows for project ${projectId}`);
  const cacheProbe = options.cacheProbePath
    ? await summarizeCacheProbe(options.cacheProbePath)
    : undefined;
  const dbTrace = options.dbTracePath
    ? await summarizeStorefrontDbTraces(options.dbTracePath)
    : undefined;
  return {
    ...(cacheProbe ? { cacheProbe } : {}),
    ...(dbTrace ? { dbTrace } : {}),
    deploymentSha: options.deploymentSha.toLowerCase(),
    ignoredRows,
    label: options.label,
    projectId,
    sourceSha256: sha256(bytes),
    totalRows: rows.length,
    observedChargePeriod: { end: observedEnd, start: observedStart },
    ...(requestedWindow ? { requestedWindow } : {}),
    metrics: {
      projectEffectiveCostUsd: roundMetric(projectEffectiveCostUsd),
      services: Object.fromEntries(
        Object.entries(services).map(([metric, value]) => [
          metric,
          roundMetric(value),
        ])
      ) as Record<MetricName, number>,
    },
  };
}

export async function measureVercelStorefrontCost(options: {
  after?: { inputPath: string; window: WindowOptions };
  before: { inputPath: string; window: WindowOptions };
  projectId: string;
}): Promise<StorefrontCostMeasurement> {
  const before = await summarizeBillingWindow(
    options.before.inputPath,
    options.projectId,
    options.before.window
  );
  const after = options.after
    ? await summarizeBillingWindow(
        options.after.inputPath,
        options.projectId,
        options.after.window
      )
    : null;
  const hasDbTracePair = Boolean(before.dbTrace && after?.dbTrace);
  const hasComparableDbTraces =
    after !== null && areDbTracesComparable(before, after);
  if (after) {
    if (before.sourceSha256 === after.sourceSha256) {
      throw new Error(
        'before and after billing exports must not reuse the same evidence'
      );
    }
    if (before.deploymentSha === after.deploymentSha) {
      throw new Error(
        'before and after measurement windows must use different deployment SHAs'
      );
    }
    if (
      before.dbTrace &&
      after.dbTrace &&
      before.dbTrace.sourceSha256 === after.dbTrace.sourceSha256
    ) {
      throw new Error(
        'before and after DB traces must not reuse the same evidence'
      );
    }
    const beforeHasRequestedWindow = Boolean(before.requestedWindow);
    const afterHasRequestedWindow = Boolean(after.requestedWindow);
    if (beforeHasRequestedWindow !== afterHasRequestedWindow) {
      throw new Error(
        'before and after measurement windows must both supply requested windows or neither'
      );
    }
    if (
      comparableWindowDurationMs(before) !== comparableWindowDurationMs(after)
    ) {
      throw new Error(
        'before and after measurement windows must have equal durations'
      );
    }
    const beforeBounds = before.requestedWindow ?? before.observedChargePeriod;
    const afterBounds = after.requestedWindow ?? after.observedChargePeriod;
    if (beforeBounds.end > afterBounds.start) {
      throw new Error('before and after measurement windows must not overlap');
    }
  }
  return {
    after,
    before,
    comparisonStatus: after
      ? hasComparableDbTraces
        ? 'complete'
        : 'incomplete'
      : 'not_available',
    comparison: after
      ? compareStorefrontCostWindows(
          hasComparableDbTraces ? before : withoutDbTrace(before),
          hasComparableDbTraces ? after : withoutDbTrace(after)
        )
      : null,
    limitations: [
      'FOCUS billing rows are project-level; they cannot attribute CPU, memory, or invocations to PDP, compare, or blog routes.',
      'The requested window is recorded as provenance; supply exports already filtered to that UTC window because billing rows are not split by route or request.',
      ...(hasComparableDbTraces
        ? []
        : hasDbTracePair
          ? [
              'Comparison is incomplete because before and after DB traces do not share matching per-cohort sample sizes; raw DB totals are suppressed until comparable route samples are supplied.',
            ]
          : [
              'Comparison is incomplete without both before and after DB traces; Vercel billing exports do not contain database-call counts. Provide bounded DB trace JSONL inputs or collect the same fields from Supabase telemetry.',
            ]),
      'Cache hit ratio requires the optional sampled cache-probe JSONL; it is not a billing-export field and is not a census.',
      ...(after
        ? []
        : [
            'No after window was supplied, so no before/after savings claim is produced.',
          ]),
    ],
    projectId: options.projectId,
    schemaVersion: 1,
  };
}
