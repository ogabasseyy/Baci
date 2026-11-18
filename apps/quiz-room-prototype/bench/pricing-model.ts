import type { BillingCounters } from '../src/contracts';

/**
 * Published Cloudflare Workers Paid + Durable Objects + SQLite + Queues rates
 * verified 2026-11-18 against developers.cloudflare.com.
 */
export const CLOUDFLARE_RATES = {
  workersPaidMonthlyBaseUsd: 5.0,
  workerRequestsIncludedMonthly: 10_000_000,
  workerRequestsPerMillionUsd: 0.3,
  workerCpuMsIncludedMonthly: 30_000_000,
  workerCpuMsPerMillionUsd: 0.02,
  doRequestsIncludedMonthly: 1_000_000,
  doRequestsPerMillionUsd: 0.15,
  doDurationGbSecIncludedMonthly: 400_000,
  doDurationPerMillionGbSecUsd: 12.5,
  doMemoryGbPerObject: 0.125, // 128 MB fixed billing allocation per active DO
  doSqliteRowsWrittenIncludedMonthly: 50_000_000,
  doSqliteRowsWrittenPerMillionUsd: 1.0,
  doSqliteRowsReadIncludedMonthly: 25_000_000_000,
  doSqliteRowsReadPerMillionUsd: 0.001,
  doSqliteStorageIncludedGbMonth: 5,
  doSqliteStoragePerGbMonthUsd: 0.2,
  queuesOperationsIncludedMonthly: 1_000_000,
  queuesOperationsPerMillionUsd: 0.4,
} as const;

/**
 * Published Supabase Pro rates verified 2026-11-18 against supabase.com.
 */
export const SUPABASE_RATES = {
  proMonthlyBaseUsd: 25.0,
  proComputeCreditMonthlyUsd: 10.0,
  computeHourlyUsd: {
    microBranch: 0.01344,
    small: 0.0206,
    xl: 0.2877,
    '2xl': 0.562,
    '4xl': 1.32,
  },
  authMauIncludedMonthly: 100_000,
  authMauOverageUsd: 0.00325,
  realtimeIncludedConnections: 500,
  realtimePer1kPeakOverIncludedUsd: 10.0,
  egressIncludedUncachedGbMonthly: 250,
  egressUncachedPerGbUsd: 0.09,
} as const;

export interface EventCloudflareUsage {
  entrants: number;
  completions: number;
  counters: BillingCounters;
  activeRoomHours: number;
  activeShardHours: number;
  sqliteStorageGbMonths: number;
}

export interface CloudflareCostBreakdown {
  workerRequestsUsd: number;
  workerCpuUsd: number;
  doRequestsUsd: number;
  doDurationExactUsd: number;
  doDurationRoundedUsd: number;
  doRowsWrittenUsd: number;
  doRowsReadUsd: number;
  doStorageUsd: number;
  queuesUsd: number;
  totalExactUsd: number;
  totalWithPublishedDoRoundingUsd: number;
  gbSecondsUsed: number;
}

function billableExcess(
  used: number,
  included: number,
  applyAllowances: boolean
): number {
  return applyAllowances ? Math.max(0, used - included) : used;
}

export function priceCloudflareUsage(
  usage: EventCloudflareUsage,
  applyFullMonthlyAllowances: boolean
): CloudflareCostBreakdown {
  const r = CLOUDFLARE_RATES;
  const workerReqExcess = billableExcess(
    usage.counters.workerInvocations,
    r.workerRequestsIncludedMonthly,
    applyFullMonthlyAllowances
  );
  const workerCpuExcess = billableExcess(
    usage.counters.workerCpuMs,
    r.workerCpuMsIncludedMonthly,
    applyFullMonthlyAllowances
  );
  const doReqExcess = billableExcess(
    usage.counters.roomRequests,
    r.doRequestsIncludedMonthly,
    applyFullMonthlyAllowances
  );
  const totalActiveObjectHours = usage.activeRoomHours + usage.activeShardHours;
  const gbSecondsUsed = totalActiveObjectHours * 3600 * r.doMemoryGbPerObject;
  const gbSecExcess = billableExcess(
    gbSecondsUsed,
    r.doDurationGbSecIncludedMonthly,
    applyFullMonthlyAllowances
  );
  const rowsWrittenExcess = billableExcess(
    usage.counters.rowsWritten,
    r.doSqliteRowsWrittenIncludedMonthly,
    applyFullMonthlyAllowances
  );
  const rowsReadExcess = billableExcess(
    usage.counters.rowsRead,
    r.doSqliteRowsReadIncludedMonthly,
    applyFullMonthlyAllowances
  );
  const storageExcessGbMonth = billableExcess(
    usage.sqliteStorageGbMonths,
    r.doSqliteStorageIncludedGbMonth,
    applyFullMonthlyAllowances
  );
  const queueOpsExcess = billableExcess(
    usage.counters.queueOperations,
    r.queuesOperationsIncludedMonthly,
    applyFullMonthlyAllowances
  );

  const workerRequestsUsd =
    (workerReqExcess / 1_000_000) * r.workerRequestsPerMillionUsd;
  const workerCpuUsd =
    (workerCpuExcess / 1_000_000) * r.workerCpuMsPerMillionUsd;
  const doRequestsUsd = (doReqExcess / 1_000_000) * r.doRequestsPerMillionUsd;
  const doDurationExactUsd =
    (gbSecExcess / 1_000_000) * r.doDurationPerMillionGbSecUsd;
  // Cloudflare bills excess DO duration rounded up to the next 1,000,000 GB-s unit.
  const doDurationRoundedUsd =
    gbSecExcess === 0
      ? 0
      : Math.ceil(gbSecExcess / 1_000_000) * r.doDurationPerMillionGbSecUsd;
  const doRowsWrittenUsd =
    (rowsWrittenExcess / 1_000_000) * r.doSqliteRowsWrittenPerMillionUsd;
  const doRowsReadUsd =
    (rowsReadExcess / 1_000_000) * r.doSqliteRowsReadPerMillionUsd;
  const doStorageUsd = storageExcessGbMonth * r.doSqliteStoragePerGbMonthUsd;
  const queuesUsd =
    (queueOpsExcess / 1_000_000) * r.queuesOperationsPerMillionUsd;

  const subWithoutDuration =
    workerRequestsUsd +
    workerCpuUsd +
    doRequestsUsd +
    doRowsWrittenUsd +
    doRowsReadUsd +
    doStorageUsd +
    queuesUsd;

  return {
    workerRequestsUsd,
    workerCpuUsd,
    doRequestsUsd,
    doDurationExactUsd,
    doDurationRoundedUsd,
    doRowsWrittenUsd,
    doRowsReadUsd,
    doStorageUsd,
    queuesUsd,
    totalExactUsd: subWithoutDuration + doDurationExactUsd,
    totalWithPublishedDoRoundingUsd: subWithoutDuration + doDurationRoundedUsd,
    gbSecondsUsed,
  };
}

export function priceSupabaseIncrementalAuthUsd(
  baselineActiveMausInCycle: number,
  newlyActivatedEventUsers: number
): number {
  const included = SUPABASE_RATES.authMauIncludedMonthly;
  const before = Math.max(0, baselineActiveMausInCycle - included);
  const after = Math.max(
    0,
    baselineActiveMausInCycle + newlyActivatedEventUsers - included
  );
  return (after - before) * SUPABASE_RATES.authMauOverageUsd;
}

export function scaleCountersFromSample(options: {
  sampleEntrants: number;
  targetEntrants: number;
  sampleCounters: BillingCounters;
  fixedCoordinatorAndResultOps?: Partial<BillingCounters>;
}): BillingCounters {
  const ratio = options.targetEntrants / Math.max(1, options.sampleEntrants);
  const extra = options.fixedCoordinatorAndResultOps ?? {};
  return {
    workerInvocations:
      Math.round(options.sampleCounters.workerInvocations * ratio) +
      (extra.workerInvocations ?? 0),
    workerCpuMs:
      Math.round(options.sampleCounters.workerCpuMs * ratio) +
      (extra.workerCpuMs ?? 0),
    roomRequests:
      Math.round(options.sampleCounters.roomRequests * ratio) +
      (extra.roomRequests ?? 0),
    rowsWritten:
      Math.round(options.sampleCounters.rowsWritten * ratio) +
      (extra.rowsWritten ?? 0),
    rowsRead:
      Math.round(options.sampleCounters.rowsRead * ratio) +
      (extra.rowsRead ?? 0),
    bytesPacked:
      Math.round(options.sampleCounters.bytesPacked * ratio) +
      (extra.bytesPacked ?? 0),
    queueMessages:
      Math.round(options.sampleCounters.queueMessages * ratio) +
      (extra.queueMessages ?? 0),
    queueOperations:
      Math.round(options.sampleCounters.queueOperations * ratio) +
      (extra.queueOperations ?? 0),
  };
}
