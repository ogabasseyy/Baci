import type { StorefrontCwvGuardRoute } from '../perf/storefront-cwv-guard-budgets';

export interface MonitoredStorefrontRouteTarget {
  expectedLcpElement: string;
  label: string;
  path: string;
  route: StorefrontCwvGuardRoute | 'familyHub';
}

export interface PageSpeedLcpSubparts {
  elementRenderDelayMs: number | null;
  resourceLoadDelayMs: number | null;
  resourceLoadDurationMs: number | null;
  ttfbMs: number | null;
}

export interface PageSpeedLcpDiagnostics {
  cls: number | null;
  lcpElement: string | null;
  lcpLoadDelayMs: number | null;
  lcpLoadDurationMs: number | null;
  lcpOptimisticMs: number | null;
  lcpPessimisticMs: number | null;
  lcpResourceOrigin: string | null;
  lcpResourceUrl: string | null;
  lcpSubparts: PageSpeedLcpSubparts;
  observedLcpMs: number | null;
  performanceScore: number | null;
  preLcpBytes: number | null;
  preLcpRequestCount: number | null;
  seoScore: number | null;
  simFcpMs: number | null;
  simLcpMs: number | null;
}

export interface PageSpeedMultiRunSummary {
  alerts: string[];
  lcpElementConsistent: boolean;
  lcpOriginConsistent: boolean;
  lcpSpreadMs: number | null;
  medianSimFcpMs: number | null;
  medianSimLcpMs: number | null;
  passed: boolean;
  runs: PageSpeedLcpDiagnostics[];
}

export interface PageSpeedMultiRunComparisonOptions {
  baselineMedianSimLcpMs?: number;
  expectedLcpElement?: string;
  expectedLcpOrigin?: string;
  maxAllowedSpreadMs?: number;
  maxRegressionDeltaMs?: number;
  minRuns?: number;
}

export interface LighthouseAuditItem {
  duration?: number;
  items?: unknown[];
  networkEndTime?: number;
  networkRequestTime?: number;
  node?: { selector?: string; snippet?: string };
  rendererStartTime?: number;
  resourceType?: string;
  selector?: string;
  snippet?: string;
  startTime?: number;
  subpart?: string;
  transferSize?: number;
  type?: string;
  url?: string;
}

export interface RawLighthouseAudit {
  details?: { items?: unknown[] };
  metricSavings?: Record<string, number>;
  numericValue?: number | null;
  score?: number | null;
}
