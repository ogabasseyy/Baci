export const OGABASSEY_MONITORED_CWV_ROUTES = [
  { label: 'ogabassey-home', path: '/' },
  { label: 'ogabassey-category', path: '/smartphones' },
  { label: 'ogabassey-brand-hub', path: '/smartphones/brands/apple' },
  { label: 'ogabassey-pdp', path: '/smartphones/iphone-16-pro-max' },
  {
    label: 'ogabassey-blog',
    path: '/blog/google-pixel-phones-in-nigeria-are-they-worth-buying-in-2026',
  },
] as const;

export interface PageSpeedLcpDiagnostics {
  lcpElement: string | null;
  lcpResourceOrigin: string | null;
  lcpResourceUrl: string | null;
  simFcpMs: number | null;
  simLcpMs: number | null;
}

export interface PageSpeedSeriesBaseline {
  expectedLcpElement?: string;
  expectedLcpOrigin?: string;
  medianLcpMs?: number;
}

export interface PageSpeedMultiRunSummary {
  alerts: string[];
  lcpElements: string[];
  lcpOrigins: string[];
  lcpResourceUrls: string[];
  medianFcpMs: number | null;
  medianLcpMs: number | null;
  passed: boolean;
  rangeLcpMs: [number, number] | null;
  spreadLcpMs: number | null;
}

export interface AuditDetailsNode {
  nodeLabel?: string;
  selector?: string;
  snippet?: string;
}

export interface RawAuditItem extends AuditDetailsNode {
  items?: Array<{ node?: AuditDetailsNode; url?: string }>;
  node?: AuditDetailsNode;
  priority?: string;
  resourceType?: string;
  type?: string;
  url?: string;
}

export interface PageSpeedInsightAuditEntry {
  details?: { items?: RawAuditItem[] };
  numericValue?: number | null;
  score?: number | null;
}

export interface PageSpeedDiagnosticPayload {
  lighthouseResult?: {
    audits?: Record<string, PageSpeedInsightAuditEntry>;
  };
}

function getOriginSafely(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function extractNodeLabel(node?: AuditDetailsNode): string | null {
  if (!node) return null;
  const candidate = node.selector || node.nodeLabel || node.snippet;
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

function extractSnippetSrcPrefix(snippet?: string): string | null {
  if (!snippet) return null;
  const rawSrc = snippet.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  if (!rawSrc) return null;
  const withoutEllipsis = rawSrc.replace(/\u2026|\.\.\.$/, '').trim();
  return withoutEllipsis.startsWith('http') ? withoutEllipsis : null;
}

function resolveLcpResourceUrl(
  audits: Record<string, PageSpeedInsightAuditEntry> | undefined
): string | null {
  const discoveryItems =
    audits?.['lcp-discovery-insight']?.details?.items ?? [];
  for (const item of discoveryItems) {
    if (typeof item.url === 'string' && item.url.startsWith('http')) {
      return item.url;
    }
  }

  const nodeSnippets: string[] = [];
  for (const item of [
    ...discoveryItems,
    ...(audits?.['lcp-breakdown-insight']?.details?.items ?? []),
  ]) {
    if (item.type === 'node') {
      if (item.snippet) nodeSnippets.push(item.snippet);
      if (item.node?.snippet) nodeSnippets.push(item.node.snippet);
    }
  }

  const netItems = audits?.['network-requests']?.details?.items ?? [];
  for (const snippet of nodeSnippets) {
    const prefix = extractSnippetSrcPrefix(snippet);
    if (!prefix) continue;
    const matchedReq = netItems.find(
      (req) => typeof req.url === 'string' && req.url.startsWith(prefix)
    );
    if (matchedReq?.url) return matchedReq.url;
    if (getOriginSafely(prefix)) return prefix;
  }

  return null;
}

export function extractPageSpeedLcpDiagnostics(
  payload: PageSpeedDiagnosticPayload
): PageSpeedLcpDiagnostics {
  const audits = payload.lighthouseResult?.audits;

  const simFcpMs =
    typeof audits?.['first-contentful-paint']?.numericValue === 'number'
      ? Math.round(audits['first-contentful-paint'].numericValue)
      : null;
  const simLcpMs =
    typeof audits?.['largest-contentful-paint']?.numericValue === 'number'
      ? Math.round(audits['largest-contentful-paint'].numericValue)
      : null;

  let lcpElement: string | null = null;
  const breakdownItems =
    audits?.['lcp-breakdown-insight']?.details?.items ?? [];
  for (const item of breakdownItems) {
    if (item.type === 'node') {
      lcpElement = extractNodeLabel(item) ?? extractNodeLabel(item.node);
      if (lcpElement) break;
    }
  }

  if (!lcpElement) {
    const legacyItems =
      audits?.['largest-contentful-paint-element']?.details?.items ?? [];
    for (const item of legacyItems) {
      lcpElement = extractNodeLabel(item.node);
      if (lcpElement) break;
      for (const sub of item.items ?? []) {
        lcpElement = extractNodeLabel(sub.node);
        if (lcpElement) break;
      }
      if (lcpElement) break;
    }
  }

  const lcpResourceUrl = resolveLcpResourceUrl(audits);

  return {
    lcpElement,
    lcpResourceOrigin: getOriginSafely(lcpResourceUrl),
    lcpResourceUrl,
    simFcpMs,
    simLcpMs,
  };
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function evaluatePageSpeedMultiRunSeries(options: {
  baseline?: PageSpeedSeriesBaseline;
  maxIntraSeriesSpreadMs?: number;
  maxLcpRegressionMs?: number;
  runs: PageSpeedLcpDiagnostics[];
}): PageSpeedMultiRunSummary {
  const {
    runs,
    baseline,
    maxLcpRegressionMs = 300,
    maxIntraSeriesSpreadMs,
  } = options;
  const lcpValues = runs
    .map((r) => r.simLcpMs)
    .filter((v): v is number => typeof v === 'number');
  const fcpValues = runs
    .map((r) => r.simFcpMs)
    .filter((v): v is number => typeof v === 'number');

  const medianLcpMs = computeMedian(lcpValues);
  const medianFcpMs = computeMedian(fcpValues);
  const rangeLcpMs: [number, number] | null =
    lcpValues.length > 0
      ? [Math.min(...lcpValues), Math.max(...lcpValues)]
      : null;
  const spreadLcpMs = rangeLcpMs ? rangeLcpMs[1] - rangeLcpMs[0] : null;

  const lcpElements = [
    ...new Set(
      runs.map((r) => r.lcpElement).filter((v): v is string => Boolean(v))
    ),
  ];
  const lcpOrigins = [
    ...new Set(
      runs
        .map((r) => r.lcpResourceOrigin)
        .filter((v): v is string => Boolean(v))
    ),
  ];
  const lcpResourceUrls = [
    ...new Set(
      runs.map((r) => r.lcpResourceUrl).filter((v): v is string => Boolean(v))
    ),
  ];

  const alerts: string[] = [];

  if (lcpValues.length === 0) {
    alerts.push('No simLCP values extracted from any run');
  } else if (lcpValues.length < runs.length) {
    alerts.push(
      `simLCP extracted from only ${lcpValues.length} of ${runs.length} runs`
    );
  }
  if (baseline?.expectedLcpElement && lcpElements.length === 0) {
    alerts.push('No LCP element extracted from any run');
  }
  if (baseline?.expectedLcpOrigin && lcpOrigins.length === 0) {
    alerts.push('No LCP resource origin extracted from any run');
  }

  if (lcpElements.length > 1) {
    alerts.push(`LCP element flipped across runs: ${lcpElements.join(' vs ')}`);
  }
  if (
    baseline?.expectedLcpElement &&
    lcpElements.some((el) => !el.includes(baseline.expectedLcpElement ?? ''))
  ) {
    alerts.push(
      `LCP element "${lcpElements.join(', ')}" drifted from expected "${baseline.expectedLcpElement}"`
    );
  }

  if (lcpOrigins.length > 1) {
    alerts.push(`LCP origin flipped across runs: ${lcpOrigins.join(' vs ')}`);
  }
  if (
    baseline?.expectedLcpOrigin &&
    lcpOrigins.some((origin) => origin !== baseline.expectedLcpOrigin)
  ) {
    alerts.push(
      `LCP origin "${lcpOrigins.join(', ')}" drifted from expected "${baseline.expectedLcpOrigin}"`
    );
  }

  if (
    typeof baseline?.medianLcpMs === 'number' &&
    typeof medianLcpMs === 'number' &&
    medianLcpMs - baseline.medianLcpMs > maxLcpRegressionMs
  ) {
    alerts.push(
      `Median simLCP ${medianLcpMs}ms regressed by ${medianLcpMs - baseline.medianLcpMs}ms (> ${maxLcpRegressionMs}ms) from baseline ${baseline.medianLcpMs}ms`
    );
  }

  if (
    typeof maxIntraSeriesSpreadMs === 'number' &&
    typeof spreadLcpMs === 'number' &&
    spreadLcpMs > maxIntraSeriesSpreadMs
  ) {
    alerts.push(
      `simLCP spread ${spreadLcpMs}ms exceeds stability cap ${maxIntraSeriesSpreadMs}ms`
    );
  }

  return {
    alerts,
    lcpElements,
    lcpOrigins,
    lcpResourceUrls,
    medianFcpMs,
    medianLcpMs,
    passed: alerts.length === 0,
    rangeLcpMs,
    spreadLcpMs,
  };
}
