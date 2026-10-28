import type {
  MonitoredStorefrontRouteTarget,
  PageSpeedLcpDiagnostics,
  PageSpeedMultiRunComparisonOptions,
  PageSpeedMultiRunSummary,
  RawLighthouseAudit,
} from './page-speed-lcp-diagnostics.types';
import {
  computeMedian,
  extractLcpSelector,
  extractLcpSubparts,
  getNum,
  isImageLcpNode,
  isRecord,
  matchesExpectedSelector,
  parseOrigin,
  resolveLcpResourceUrl,
} from './page-speed-lcp-extractors';

export type * from './page-speed-lcp-diagnostics.types';
export { computeMedian, matchesExpectedSelector };

const ROUTES: ReadonlyArray<
  readonly [MonitoredStorefrontRouteTarget['route'], string, string, string]
> = [
  ['home', 'Home', '/', 'picture > img'],
  ['category', 'Category (Smartphones)', '/smartphones', 'picture > img'],
  ['brandHub', 'Brand Hub (Apple)', '/smartphones/brands/apple', 'header > p'],
  [
    'familyHub',
    'Family Hub',
    '/smartphones/brands/apple/families/iphone-16',
    'header > p',
  ],
  ['pdp', 'PDP', '/smartphones/iphone-16-pro-max', 'picture > img'],
  [
    'blogPost',
    'Blog Post',
    '/blog/google-pixel-phones-in-nigeria-are-they-worth-buying-in-2026',
    'header > h1',
  ],
];

export const OGABASSEY_MONITORED_CWV_ROUTES: readonly MonitoredStorefrontRouteTarget[] =
  ROUTES.map(([route, label, path, expectedLcpElement]) => ({
    expectedLcpElement,
    label,
    path,
    route,
  }));

/** Extracts Lantern/metrics LCP timings, LCP element, subparts, and pre-LCP network totals from a PSI/LH payload. */
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
  const cats = isRecord(lhr.categories) ? lhr.categories : {};
  const getScore = (id: string) => {
    const cat = cats[id];
    return isRecord(cat) && typeof cat.score === 'number'
      ? Math.round(cat.score * 100)
      : null;
  };
  const firstMetricsItem = audits.metrics?.details?.items?.[0];
  const mItem = isRecord(firstMetricsItem) ? firstMetricsItem : null;
  const lcpSubparts = extractLcpSubparts(audits);
  const subVals = Object.values(lcpSubparts).filter(
    (v): v is number => v !== null
  );
  const observedLcpMs =
    getNum(mItem?.observedLargestContentfulPaint) ??
    (subVals.length > 0 ? subVals.reduce((a, b) => a + b, 0) : null);
  const simLcpMs =
    getNum(audits['largest-contentful-paint']?.numericValue) ??
    getNum(mItem?.largestContentfulPaint);
  const cutoffMs = observedLcpMs ?? simLcpMs;

  let preLcpRequestCount: number | null = null;
  let preLcpBytes: number | null = null;
  const netItems = audits['network-requests']?.details?.items;
  if (Array.isArray(netItems) && cutoffMs !== null) {
    let count = 0;
    let bytes = 0;
    let missingTiming = false;
    for (const it of netItems) {
      if (
        !isRecord(it) ||
        !['Document', 'Stylesheet', 'Script', 'Image'].includes(
          String(it.resourceType)
        )
      )
        continue;
      const start =
        getNum(it.networkRequestTime) ??
        getNum(it.rendererStartTime) ??
        getNum(it.startTime) ??
        getNum(it.networkEndTime);
      if (start === null) {
        missingTiming = true;
        break;
      }
      if (start <= cutoffMs) {
        count += 1;
        bytes += getNum(it.transferSize) ?? 0;
      }
    }
    if (!missingTiming) {
      preLcpRequestCount = count;
      preLcpBytes = bytes;
    }
  }

  const { selector: lcpElement, snippet } = extractLcpSelector(audits);
  const lcpResourceUrl = resolveLcpResourceUrl(
    audits,
    lcpElement,
    snippet,
    cutoffMs
  );
  return {
    cls: getNum(audits['cumulative-layout-shift']?.numericValue),
    lcpElement,
    lcpLoadDelayMs:
      getNum(mItem?.lcpLoadDelay) ?? lcpSubparts.resourceLoadDelayMs,
    lcpLoadDurationMs:
      getNum(mItem?.lcpLoadDuration) ?? lcpSubparts.resourceLoadDurationMs,
    lcpResourceOrigin: parseOrigin(lcpResourceUrl),
    lcpResourceUrl,
    lcpSubparts,
    observedLcpMs,
    performanceScore: getScore('performance'),
    preLcpBytes,
    preLcpRequestCount,
    seoScore: getScore('seo'),
    simFcpMs:
      getNum(audits['first-contentful-paint']?.numericValue) ??
      getNum(mItem?.firstContentfulPaint),
    simLcpMs,
  };
}

/** Evaluates a multi-run PSI/Lighthouse series for run count, median LCP, spread, and element/origin drift. */
export function evaluatePageSpeedMultiRunSeries(
  runs: readonly PageSpeedLcpDiagnostics[],
  options: PageSpeedMultiRunComparisonOptions = {}
): PageSpeedMultiRunSummary {
  const alerts: string[] = [];
  const minRuns = options.minRuns ?? 5;
  if (runs.length < minRuns)
    alerts.push(
      `Expected at least ${minRuns} runs for multi-run evaluation, received ${runs.length}`
    );
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
  if (runs.length === 0 || simLcpValues.length < runs.length)
    alerts.push('Missing simulated LCP values in multi-run series');
  if (runs.some((r) => !r.lcpElement))
    alerts.push('One or more runs are missing LCP element diagnostics');
  const expectsImageOrigin =
    Boolean(options.expectedLcpOrigin) ||
    runs.some((r) => isImageLcpNode(r.lcpElement, null));
  if (expectsImageOrigin && runs.some((r) => !r.lcpResourceOrigin))
    alerts.push('One or more runs are missing LCP resource origin diagnostics');
  if (lcpElements.length > 1)
    alerts.push(`LCP element flipped across runs: ${lcpElements.join(' vs ')}`);
  if (
    options.expectedLcpElement &&
    lcpElements.some(
      (el) =>
        el && !matchesExpectedSelector(el, options.expectedLcpElement ?? '')
    )
  )
    alerts.push(
      `LCP element drifted from expected "${options.expectedLcpElement}": found ${lcpElements.join(', ')}`
    );
  if (lcpOrigins.length > 1)
    alerts.push(
      `LCP resource origin changed across runs: ${lcpOrigins.join(' vs ')}`
    );
  if (
    options.expectedLcpOrigin &&
    lcpOrigins.some((o) => o !== options.expectedLcpOrigin)
  )
    alerts.push(
      `LCP resource origin drifted from expected "${options.expectedLcpOrigin}": found ${lcpOrigins.join(', ')}`
    );
  const maxSpread = options.maxAllowedSpreadMs ?? 150;
  if (lcpSpreadMs !== null && lcpSpreadMs > maxSpread)
    alerts.push(
      `Simulated LCP spread ${Math.round(lcpSpreadMs)}ms exceeds ${maxSpread}ms stability cap`
    );
  const maxReg = options.maxRegressionDeltaMs ?? 300;
  if (
    options.baselineMedianSimLcpMs !== undefined &&
    medianSimLcpMs !== null &&
    medianSimLcpMs - options.baselineMedianSimLcpMs > maxReg
  )
    alerts.push(
      `Median simulated LCP regressed by ${Math.round(medianSimLcpMs - options.baselineMedianSimLcpMs)}ms (threshold ${maxReg}ms)`
    );
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
