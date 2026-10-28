import type { StorefrontCwvGuardRoute } from '../perf/storefront-cwv-guard-budgets';

export interface MonitoredStorefrontRouteTarget {
  expectedLcpElement: string;
  label: string;
  path: string;
  route: StorefrontCwvGuardRoute | 'familyHub';
}

export const OGABASSEY_MONITORED_CWV_ROUTES: readonly MonitoredStorefrontRouteTarget[] =
  [
    {
      route: 'home',
      label: 'Home',
      path: '/',
      expectedLcpElement: 'picture > img',
    },
    {
      route: 'category',
      label: 'Category (Smartphones)',
      path: '/smartphones',
      expectedLcpElement: 'picture > img',
    },
    {
      route: 'brandHub',
      label: 'Brand Hub (Apple Smartphones)',
      path: '/smartphones/brands/apple',
      expectedLcpElement: 'header > p',
    },
    {
      route: 'familyHub',
      label: 'Family Hub (iPhone 16)',
      path: '/smartphones/brands/apple/families/iphone-16',
      expectedLcpElement: 'header > p',
    },
    {
      route: 'pdp',
      label: 'PDP (iPhone 16 Pro Max)',
      path: '/smartphones/iphone-16-pro-max',
      expectedLcpElement: 'picture > img',
    },
    {
      route: 'blogPost',
      label: 'Blog Post',
      path: '/blog/google-pixel-phones-in-nigeria-are-they-worth-buying-in-2026',
      expectedLcpElement: 'header > h1',
    },
  ] as const;

export interface PageSpeedLcpDiagnostics {
  cls: number | null;
  lcpElement: string | null;
  lcpOptimisticMs: number | null;
  lcpPessimisticMs: number | null;
  lcpResourceOrigin: string | null;
  lcpResourceUrl: string | null;
  performanceScore: number | null;
  preLcpBytes: number;
  preLcpRequestCount: number;
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
  node?: { selector?: string; snippet?: string };
  resourceType?: string;
  transferSize?: number;
  url?: string;
}

export interface RawLighthouseAudit {
  details?: { items?: unknown[] };
  metricSavings?: Record<string, number>;
  numericValue?: number | null;
  score?: number | null;
}

/** Narrows an unknown value to a plain object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extracts the URL origin or returns null when invalid. */
export function parseOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Computes the statistical median of a numeric array. */
export function computeMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Determines whether the LCP node represents an image/media resource rather than text. */
export function isImageLcpNode(
  selector: string | null,
  snippet: string | null
): boolean {
  if (snippet && /^<(?:img|picture|source|svg|video)\b/i.test(snippet)) {
    return true;
  }
  if (!selector) return false;
  return /(?:^|[\s>+~])(?:img|picture|source|svg|video)(?:[.#[:\s>+~]|$)/i.test(
    selector
  );
}
