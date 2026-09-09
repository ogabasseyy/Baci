import {
  getDebugBearCategoryScore,
  getDebugBearMetric,
} from './debugbear-quick-test-utils.mjs';

const PSI_CATEGORIES = [
  'performance',
  'accessibility',
  'best-practices',
  'seo',
];

function score(category) {
  return typeof category?.score === 'number'
    ? Math.round(category.score <= 1 ? category.score * 100 : category.score)
    : null;
}

function auditMetric(audits, id) {
  const value = audits?.[id]?.numericValue;
  return typeof value === 'number' ? value : null;
}

function normalizeFieldId(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return `${value ?? ''}`;
  }
}

function normalizeFieldPercentile(metricName, percentile) {
  if (typeof percentile !== 'number') return null;
  if (metricName === 'CUMULATIVE_LAYOUT_SHIFT_SCORE') {
    return percentile / 100;
  }
  return percentile;
}

function getFieldMetric(payload, requestedUrl, metricName) {
  const candidates = [
    { experience: payload?.loadingExperience, scope: null },
    { experience: payload?.originLoadingExperience, scope: 'origin' },
  ];
  const requested = normalizeFieldId(requestedUrl);

  for (const candidateEntry of candidates) {
    const candidate = candidateEntry.experience;
    const metric = candidate?.metrics?.[metricName];
    if (!metric) continue;

    return {
      category: metric.category,
      p75: normalizeFieldPercentile(metricName, metric.percentile),
      scope:
        candidateEntry.scope ??
        (candidate.origin_fallback === true || candidate.originFallback === true
          ? 'origin'
          : normalizeFieldId(candidate.id) === requested
            ? 'url'
            : 'origin'),
    };
  }

  return null;
}

function buildPsiUrl({ apiKey, strategy, url }) {
  const endpoint = new URL(
    'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
  );
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', strategy);
  for (const category of PSI_CATEGORIES) {
    endpoint.searchParams.append('category', category);
  }
  if (apiKey) endpoint.searchParams.set('key', apiKey);
  return endpoint;
}

function printCwvSummaryTable(rows) {
  console.table(
    rows.map((row) => ({
      route: row.label,
      source: row.source,
      strategy: row.strategy ?? row.device ?? '-',
      perf: row.performance ?? '-',
      seo: row.seo ?? '-',
      lcp: formatMetricMs(row.lcpMs) ?? '-',
      fcp: formatMetricMs(row.fcpMs) ?? '-',
      tbt: formatMetricMs(row.tbtMs) ?? '-',
      cls: row.cls ?? '-',
      inp: formatMetricMs(row.inpMs ?? row.fieldInp?.p75) ?? '-',
      fieldLcp: row.fieldLcp?.p75 ?? '-',
      fieldScope: row.fieldLcp?.scope ?? '-',
      result: row.resultUrl ?? '-',
    }))
  );
}

function summarizePsiResult({ label, payload, requestedUrl, strategy }) {
  const lighthouse = payload?.lighthouseResult ?? {};
  const audits = lighthouse.audits ?? {};
  const categories = lighthouse.categories ?? {};
  const fieldInp = getFieldMetric(
    payload,
    requestedUrl,
    'INTERACTION_TO_NEXT_PAINT'
  );

  return {
    a11y: score(categories.accessibility),
    bp: score(categories['best-practices']),
    cls: auditMetric(audits, 'cumulative-layout-shift'),
    fieldCls: getFieldMetric(
      payload,
      requestedUrl,
      'CUMULATIVE_LAYOUT_SHIFT_SCORE'
    ),
    fieldFcp: getFieldMetric(
      payload,
      requestedUrl,
      'FIRST_CONTENTFUL_PAINT_MS'
    ),
    fieldInp,
    fieldLcp: getFieldMetric(
      payload,
      requestedUrl,
      'LARGEST_CONTENTFUL_PAINT_MS'
    ),
    fieldTtfb: getFieldMetric(
      payload,
      requestedUrl,
      'EXPERIMENTAL_TIME_TO_FIRST_BYTE'
    ),
    fcpMs: auditMetric(audits, 'first-contentful-paint'),
    finalUrl: lighthouse.finalUrl ?? payload?.id ?? requestedUrl,
    inpMs: auditMetric(audits, 'interaction-to-next-paint') ?? fieldInp?.p75,
    label,
    lcpMs: auditMetric(audits, 'largest-contentful-paint'),
    performance: score(categories.performance),
    seo: score(categories.seo),
    source: 'psi',
    speedIndexMs: auditMetric(audits, 'speed-index'),
    strategy,
    tbtMs: auditMetric(audits, 'total-blocking-time'),
    url: requestedUrl,
  };
}

function getDebugBearStatus(body) {
  return `${body?.status ?? body?.state ?? ''}`.trim().toLowerCase();
}

function isDebugBearComplete(body) {
  const status = getDebugBearStatus(body);
  return (
    body?.hasFinished === true ||
    status === 'complete' ||
    status === 'completed' ||
    status === 'success' ||
    status === 'neutral' ||
    status === 'failure' ||
    status === 'failed' ||
    Boolean(body?.lighthouseResult) ||
    Boolean(body?.metrics?.['performance.largestContentfulPaint'])
  );
}

function getDebugBearFailureMessage(body) {
  const status = getDebugBearStatus(body);
  if (status === 'failure' || status === 'failed') {
    if (typeof body?.error?.message === 'string' && body.error.message.trim()) {
      return body.error.message;
    }
    if (typeof body?.error === 'string' && body.error.trim()) {
      return body.error;
    }
    return 'DebugBear test status was failure';
  }
  if (typeof body?.error === 'string' && body.error.trim()) {
    return body.error;
  }
  if (typeof body?.error?.message === 'string' && body.error.message.trim()) {
    return body.error.message;
  }
  return null;
}

function summarizeDebugBearResult({
  body,
  label,
  device,
  projectId,
  quickTestId,
  region,
  url,
}) {
  return {
    a11y: getDebugBearCategoryScore(body, ['accessibility']),
    bp: getDebugBearCategoryScore(body, ['best-practices', 'bestPractices']),
    cls: getDebugBearMetric(body, [
      'performance.cumulativeLayoutShift',
      'cumulativeLayoutShift',
      'cls',
      'cumulative-layout-shift',
    ]),
    consoleErrors: getDebugBearMetric(body, [
      'console.errors',
      'console.totalErrors',
      'console.errorCount',
      'consoleErrors',
    ]),
    device,
    fcpMs: getDebugBearMetric(body, [
      'performance.firstContentfulPaint',
      'firstContentfulPaint',
      'fcp',
      'first-contentful-paint',
    ]),
    label,
    lcpMs: getDebugBearMetric(body, [
      'performance.largestContentfulPaint',
      'largestContentfulPaint',
      'lcp',
      'largest-contentful-paint',
    ]),
    inpMs: getDebugBearMetric(body, [
      'crux.url.inp.p75',
      'crux.origin.inp.p75',
      'crux.url.interactionToNextPaint.p75',
      'crux.origin.interactionToNextPaint.p75',
      'crux.inp.p75',
      'crux.interactionToNextPaint.p75',
      'performance.interactionToNextPaint',
      'interactionToNextPaint',
      'inp',
    ]),
    pageWeightKb: toKilobytes(
      getDebugBearMetric(body, [
        'pageWeight.total',
        'totalByteWeight',
        'pageWeight',
      ])
    ),
    performance: getDebugBearCategoryScore(body, ['performance']),
    projectId,
    quickTestId,
    region,
    resultUrl:
      body?.resultUrl ??
      body?.dashboardUrl ??
      body?.links?.result ??
      body?.links?.overview ??
      (projectId && quickTestId
        ? `https://www.debugbear.com/project/${projectId}/quickTest/${quickTestId}/overview`
        : null),
    seo: getDebugBearCategoryScore(body, ['seo']),
    source: 'debugbear',
    speedIndexMs: getDebugBearMetric(body, [
      'performance.speedIndex',
      'speedIndex',
      'speed-index',
    ]),
    tbtMs: getDebugBearMetric(body, [
      'performance.totalBlockingTime',
      'totalBlockingTime',
      'tbt',
      'total-blocking-time',
    ]),
    url,
  };
}

function toKilobytes(bytes) {
  if (typeof bytes !== 'number') return null;
  return Math.round((bytes / 1024) * 10) / 10;
}

function formatMetricMs(value) {
  return typeof value === 'number' ? Math.round(value) : null;
}

export const ogabasseyCwvSummary = Object.freeze({
  getFieldMetric,
  buildPsiUrl,
  printCwvSummaryTable,
  summarizePsiResult,
  getDebugBearStatus,
  isDebugBearComplete,
  getDebugBearFailureMessage,
  summarizeDebugBearResult,
  formatMetricMs,
});
