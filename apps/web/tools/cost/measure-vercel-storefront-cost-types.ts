export const MAX_INPUT_BYTES = 32 * 1024 * 1024;
export const MAX_INPUT_ROWS = 100_000;

export const SERVICE_METRICS = {
  'Drains Volume': 'drainsVolumeGb',
  'Fast Origin Transfer': 'fastOriginTransferGb',
  'Fluid Active CPU': 'fluidActiveCpuHours',
  'Fluid Provisioned Memory': 'fluidProvisionedMemoryGbHours',
  'Function Duration': 'functionDurationGbHours',
  'Function Invocations': 'functionInvocations',
  'Global Config Reads (formerly known as Edge Config Reads)':
    'globalConfigReads',
  'ISR Reads': 'isrReads',
  'ISR Writes': 'isrWrites',
  'Runtime Cache Reads': 'runtimeCacheReads',
  'Runtime Cache Writes': 'runtimeCacheWrites',
} as const;

/** FOCUS ConsumedUnit expected for each recognized ServiceName metric. */
export const SERVICE_CONSUMED_UNITS = {
  'Drains Volume': 'GB',
  'Fast Origin Transfer': 'GB',
  'Fluid Active CPU': 'Hours',
  'Fluid Provisioned Memory': 'GB-Hours',
  'Function Duration': 'GB-Hours',
  'Function Invocations': 'Count',
  'Global Config Reads (formerly known as Edge Config Reads)': 'Count',
  'ISR Reads': 'Count',
  'ISR Writes': 'Count',
  'Runtime Cache Reads': 'Count',
  'Runtime Cache Writes': 'Count',
} as const satisfies Record<keyof typeof SERVICE_METRICS, string>;

export type MetricName = (typeof SERVICE_METRICS)[keyof typeof SERVICE_METRICS];
export type ServiceName = keyof typeof SERVICE_METRICS;

export type StorefrontBillingMetrics = Readonly<{
  projectEffectiveCostUsd: number;
  services: Readonly<Record<MetricName, number>>;
}>;

export type CacheProbeMetrics = Readonly<{
  cacheStatusRows: number;
  cacheHitRows: number;
  cacheHitRatio: number | null;
  p50TtfbMs: number | null;
  p95TtfbMs: number | null;
  rows: number;
  sourceSha256: string;
}>;

export type StorefrontDbTraceMetrics = Readonly<{
  byCohort: Readonly<
    Record<
      string,
      Readonly<{
        dbCalls: number;
        dbCallsPerRequest: number;
        dbTimeoutRate: number | null;
        dbTimeouts: number;
        rows: number;
      }>
    >
  >;
  dbCalls: number;
  dbCallsPerRequest: number;
  dbTimeoutRate: number | null;
  dbTimeouts: number;
  rows: number;
  sourceSha256: string;
}>;

export type CostWindowMeasurement = Readonly<{
  cacheProbe?: CacheProbeMetrics;
  dbTrace?: StorefrontDbTraceMetrics;
  deploymentSha: string;
  ignoredRows: number;
  label: string;
  projectId: string;
  sourceSha256: string;
  totalRows: number;
  observedChargePeriod: Readonly<{
    end: string;
    start: string;
  }>;
  requestedWindow?: Readonly<{
    end: string;
    start: string;
  }>;
  metrics: StorefrontBillingMetrics;
}>;

export type StorefrontCostMeasurement = Readonly<{
  after: CostWindowMeasurement | null;
  before: CostWindowMeasurement;
  comparisonStatus: 'complete' | 'incomplete' | 'not_available';
  comparison: Readonly<
    Record<
      string,
      Readonly<{
        absoluteDelta: number;
        after: number;
        before: number;
        relativeChangePct: number | null;
      }>
    >
  > | null;
  limitations: readonly string[];
  projectId: string;
  schemaVersion: 1;
}>;

export type WindowOptions = Readonly<{
  cacheProbePath?: string;
  dbTracePath?: string;
  deploymentSha: string;
  label: string;
  requestedWindowEnd?: string;
  requestedWindowStart?: string;
}>;
