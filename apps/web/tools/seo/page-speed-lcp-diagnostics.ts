import {
  computeMedian,
  isImageLcpNode,
  isRecord,
  type LighthouseAuditItem,
  type MonitoredStorefrontRouteTarget,
  OGABASSEY_MONITORED_CWV_ROUTES,
  type PageSpeedLcpDiagnostics,
  type PageSpeedMultiRunComparisonOptions,
  type PageSpeedMultiRunSummary,
  parseOrigin,
  type RawLighthouseAudit,
} from './page-speed-lcp-diagnostics.types';

export {
  computeMedian,
  type MonitoredStorefrontRouteTarget,
  OGABASSEY_MONITORED_CWV_ROUTES,
  type PageSpeedLcpDiagnostics,
  type PageSpeedMultiRunComparisonOptions,
  type PageSpeedMultiRunSummary,
};

/** Extracts the LCP element selector and snippet from Lighthouse `lcp-breakdown-insight`. */
function extractLcpSelector(audits: Record<string, RawLighthouseAudit>): {
  selector: string | null;
  snippet: string | null;
} {
  const items = audits['lcp-breakdown-insight']?.details?.items;
  if (!Array.isArray(items)) return { selector: null, snippet: null };
  for (const item of items) {
    if (!isRecord(item) || !isRecord(item.node)) continue;
    const selector =
      typeof item.node.selector === 'string' && item.node.selector.trim()
        ? item.node.selector.trim()
        : null;
    const snippet =
      typeof item.node.snippet === 'string' && item.node.snippet.trim()
        ? item.node.snippet.trim()
        : null;
    if (selector || snippet) return { selector, snippet };
  }
  return { selector: null, snippet: null };
}

/** Resolves the full LCP image resource URL when the LCP element is an image node. */
function resolveLcpResourceUrl(
  audits: Record<string, RawLighthouseAudit>,
  selector: string | null,
  snippet: string | null
): string | null {
  if (!isImageLcpNode(selector, snippet)) {
    return null;
  }

  const discoveryItems = audits['lcp-discovery-insight']?.details?.items;
  if (Array.isArray(discoveryItems)) {
    for (const item of discoveryItems) {
      if (
        isRecord(item) &&
        typeof item.url === 'string' &&
        item.url.startsWith('http')
      ) {
        return item.url;
      }
    }
  }

  const rawSrc = snippet?.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? null;
  if (!rawSrc) return null;
  const isTruncated = rawSrc.includes('\u2026') || rawSrc.includes('...');
  const prefix = rawSrc.split(/\u2026|\.\.\./)[0]?.trim() ?? '';
  if (!prefix) return null;

  const netItems = audits['network-requests']?.details?.items;
  if (Array.isArray(netItems)) {
    const matches = (netItems as LighthouseAuditItem[]).filter(
      (r) =>
        typeof r?.url === 'string' &&
        r.url.startsWith(prefix) &&
        (!r.resourceType || r.resourceType === 'Image')
    );
    if (matches.length === 1 && matches[0]?.url) {
      return matches[0].url;
    }
    if (isTruncated) {
      return null;
    }
  }
  return !isTruncated && rawSrc.startsWith('http') ? rawSrc : null;
}

/** Extracts Lantern optimistic/pessimistic LCP timing, LCP element, and resource origin from a PSI/LH payload. */
export function extractPageSpeedLcpDiagnostics(
  payload: unknown
): PageSpeedLcpDiagnostics {
  const lhr =
    isRecord(payload) && isRecord(payload.lighthouseResult)
      ? payload.lighthouseResult
      : isRecord(payload)
        ? payload
        : {};
  const audits = (isRecord(lhr.audits) ? lhr.audits : {}) as Record<
    string,
    RawLighthouseAudit
  >;
  const categories = isRecord(lhr.categories) ? lhr.categories : {};

  const getScore = (id: string): number | null => {
    const cat = categories[id];
    return isRecord(cat) && typeof cat.score === 'number'
      ? Math.round(cat.score * 100)
      : null;
  };
  const getMetric = (id: string): number | null => {
    const val = audits[id]?.numericValue;
    return typeof val === 'number' ? val : null;
  };

  const lanternItems = audits['metrics-lantern']?.details?.items ??
    audits['lantern-metrics']?.details?.items ?? [
      audits['largest-contentful-paint']?.details,
    ];
  let lcpOptimisticMs: number | null = null;
  let lcpPessimisticMs: number | null = null;
  if (Array.isArray(lanternItems)) {
    for (const entry of lanternItems) {
      if (!isRecord(entry)) continue;
      if (typeof entry.optimisticLcp === 'number') {
        lcpOptimisticMs = entry.optimisticLcp;
      }
      if (typeof entry.pessimisticLcp === 'number') {
        lcpPessimisticMs = entry.pessimisticLcp;
      }
    }
  }

  let preLcpRequestCount = 0;
  let preLcpBytes = 0;
  const netItems = audits['network-requests']?.details?.items;
  if (Array.isArray(netItems)) {
    for (const item of netItems) {
      if (!isRecord(item)) continue;
      if (
        item.resourceType === 'Document' ||
        item.resourceType === 'Stylesheet' ||
        item.resourceType === 'Script' ||
        item.resourceType === 'Image'
      ) {
        preLcpRequestCount += 1;
        preLcpBytes +=
          typeof item.transferSize === 'number' ? item.transferSize : 0;
      }
    }
  }

  const { selector: lcpElement, snippet } = extractLcpSelector(audits);
  const lcpResourceUrl = resolveLcpResourceUrl(audits, lcpElement, snippet);
  return {
    cls: getMetric('cumulative-layout-shift'),
    lcpElement,
    lcpOptimisticMs,
    lcpPessimisticMs,
    lcpResourceOrigin: parseOrigin(lcpResourceUrl),
    lcpResourceUrl,
    performanceScore: getScore('performance'),
    preLcpBytes,
    preLcpRequestCount,
    seoScore: getScore('seo'),
    simFcpMs: getMetric('first-contentful-paint'),
    simLcpMs: getMetric('largest-contentful-paint'),
  };
}

/** Checks whether an extracted LCP selector matches an expected selector exactly or as its terminal path. */
function matchesExpectedSelector(actual: string, expected: string): boolean {
  return actual === expected || actual.endsWith(` > ${expected}`);
}

/** Evaluates a multi-run PSI/Lighthouse series for run count, median LCP, spread, and element/origin drift. */
export function evaluatePageSpeedMultiRunSeries(
  runs: readonly PageSpeedLcpDiagnostics[],
  options: PageSpeedMultiRunComparisonOptions = {}
): PageSpeedMultiRunSummary {
  const alerts: string[] = [];
  const minRuns = options.minRuns ?? 5;
  if (runs.length < minRuns) {
    alerts.push(
      `Expected at least ${minRuns} runs for multi-run evaluation, received ${runs.length}`
    );
  }
  const simLcpValues = runs
    .map((r) => r.simLcpMs)
    .filter((v): v is number => typeof v === 'number');
  const simFcpValues = runs
    .map((r) => r.simFcpMs)
    .filter((v): v is number => typeof v === 'number');

  const medianSimLcpMs = computeMedian(simLcpValues);
  const medianSimFcpMs = computeMedian(simFcpValues);
  const lcpSpreadMs =
    simLcpValues.length > 0
      ? Math.max(...simLcpValues) - Math.min(...simLcpValues)
      : null;

  const lcpElements = [
    ...new Set(runs.map((r) => r.lcpElement).filter(Boolean)),
  ];
  const lcpOrigins = [
    ...new Set(runs.map((r) => r.lcpResourceOrigin).filter(Boolean)),
  ];

  if (runs.length === 0 || simLcpValues.length < runs.length) {
    alerts.push('Missing simulated LCP values in multi-run series');
  }
  if (runs.some((r) => !r.lcpElement)) {
    alerts.push('One or more runs are missing LCP element diagnostics');
  }
  const expectsImageOrigin =
    Boolean(options.expectedLcpOrigin) ||
    runs.some((r) => isImageLcpNode(r.lcpElement, null));
  if (expectsImageOrigin && runs.some((r) => !r.lcpResourceOrigin)) {
    alerts.push('One or more runs are missing LCP resource origin diagnostics');
  }
  if (lcpElements.length > 1) {
    alerts.push(`LCP element flipped across runs: ${lcpElements.join(' vs ')}`);
  }
  if (
    options.expectedLcpElement &&
    lcpElements.some(
      (el) =>
        el && !matchesExpectedSelector(el, options.expectedLcpElement ?? '')
    )
  ) {
    alerts.push(
      `LCP element drifted from expected "${options.expectedLcpElement}": found ${lcpElements.join(', ')}`
    );
  }
  if (lcpOrigins.length > 1) {
    alerts.push(
      `LCP resource origin changed across runs: ${lcpOrigins.join(' vs ')}`
    );
  }
  if (
    options.expectedLcpOrigin &&
    lcpOrigins.some((origin) => origin !== options.expectedLcpOrigin)
  ) {
    alerts.push(
      `LCP resource origin drifted from expected "${options.expectedLcpOrigin}": found ${lcpOrigins.join(', ')}`
    );
  }
  const maxSpread = options.maxAllowedSpreadMs ?? 150;
  if (
    options.maxAllowedSpreadMs !== undefined &&
    lcpSpreadMs !== null &&
    lcpSpreadMs > maxSpread
  ) {
    alerts.push(
      `Simulated LCP spread ${Math.round(lcpSpreadMs)}ms exceeds ${maxSpread}ms stability cap`
    );
  }
  const maxRegression = options.maxRegressionDeltaMs ?? 300;
  if (
    options.baselineMedianSimLcpMs !== undefined &&
    medianSimLcpMs !== null &&
    medianSimLcpMs - options.baselineMedianSimLcpMs > maxRegression
  ) {
    alerts.push(
      `Median simulated LCP regressed by ${Math.round(medianSimLcpMs - options.baselineMedianSimLcpMs)}ms (threshold ${maxRegression}ms)`
    );
  }

  return {
    alerts,
    lcpElementConsistent:
      runs.length > 0 &&
      runs.every((r) => Boolean(r.lcpElement)) &&
      lcpElements.length === 1,
    lcpOriginConsistent:
      runs.length > 0 &&
      (!expectsImageOrigin ||
        runs.every((r) => Boolean(r.lcpResourceOrigin))) &&
      lcpOrigins.length <= 1,
    lcpSpreadMs,
    medianSimFcpMs,
    medianSimLcpMs,
    passed: alerts.length === 0,
    runs: [...runs],
  };
}
