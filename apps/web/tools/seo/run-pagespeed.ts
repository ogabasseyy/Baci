import {
  AUDIT_THRESHOLDS,
  CATEGORY_THRESHOLDS,
  EMPTY_PAGE_SPEED_SCORES,
  EMPTY_PAGE_SPEED_VITALS,
  PAGE_SPEED_TIMEOUT_MS,
} from './run-pagespeed.config';
import { pageSpeedShared } from './run-pagespeed.shared';
import type {
  PageSpeedApiResponse,
  PageSpeedAuditResult,
  PageSpeedFailure,
  PageSpeedStrategy,
} from './run-pagespeed.types';

function evaluatePageSpeedResult(
  payload: PageSpeedApiResponse
): Omit<PageSpeedAuditResult, 'label' | 'strategy' | 'url'> {
  const tbt = getAuditMetric(payload, 'total-blocking-time');
  const fieldInp = getFieldMetric(payload, 'INTERACTION_TO_NEXT_PAINT');
  const labInp = getAuditMetric(payload, 'interaction-to-next-paint');
  const scores = {
    performance: getCategoryScore(payload, 'performance'),
    accessibility: getCategoryScore(payload, 'accessibility'),
    seo: getCategoryScore(payload, 'seo'),
    'best-practices': getCategoryScore(payload, 'best-practices'),
  };
  const vitals = {
    lcp: getAuditMetric(payload, 'largest-contentful-paint'),
    cls: getAuditMetric(payload, 'cumulative-layout-shift'),
    tbt,
    inp: fieldInp ?? labInp,
  };
  const failures: PageSpeedFailure[] = [];
  const runtimeCode = readSafeApiToken(
    payload.lighthouseResult?.runtimeError?.code
  );
  if (runtimeCode) {
    failures.push({
      metric: 'request',
      actual: null,
      threshold: 0,
      message: `Lighthouse runtime error: ${runtimeCode}`,
    });
  }
  for (const metric of [
    'performance',
    'accessibility',
    'seo',
    'best-practices',
  ] as const) {
    const actual = scores[metric];
    const threshold = CATEGORY_THRESHOLDS[metric];
    if (actual === null || actual < threshold) {
      const failedAudits = payload.lighthouseResult?.categories?.[
        metric
      ]?.auditRefs
        ?.filter(
          (ref) =>
            ref.weight > 0 &&
            typeof payload.lighthouseResult?.audits?.[ref.id]?.score ===
              'number' &&
            (payload.lighthouseResult?.audits?.[ref.id]?.score ?? 1) < 1
        )
        .map((ref) => readSafeApiToken(ref.id))
        .filter(Boolean);
      failures.push({
        metric,
        actual,
        threshold,
        ...(failedAudits?.length
          ? {
              message: `Failing Lighthouse audits: ${[...new Set(failedAudits)].join(', ')}`,
            }
          : {}),
      });
    }
  }
  for (const metric of ['lcp', 'cls', 'tbt'] as const) {
    const actual = vitals[metric];
    const threshold = AUDIT_THRESHOLDS[metric];
    if (actual === null || actual > threshold) {
      failures.push({ metric, actual, threshold });
    }
  }
  if (vitals.inp !== null && vitals.inp > AUDIT_THRESHOLDS.inp) {
    failures.push({
      metric: 'inp',
      actual: vitals.inp,
      threshold: AUDIT_THRESHOLDS.inp,
    });
  }

  return {
    passed: failures.length === 0,
    failures,
    scores,
    vitals,
  };
}

async function runPageSpeedAudit({
  apiKey,
  baseUrl,
  extraUrls,
  fetchImpl = fetch,
  strategies,
}: {
  apiKey?: string;
  baseUrl: string;
  extraUrls: string[];
  fetchImpl?: typeof fetch;
  strategies: PageSpeedStrategy[];
}): Promise<PageSpeedAuditResult[]> {
  const targets = pageSpeedShared.buildPageSpeedTargets({ baseUrl, extraUrls });
  const results: PageSpeedAuditResult[] = [];

  for (const target of targets) {
    for (const strategy of strategies) {
      try {
        const payload = await fetchPageSpeedPayload(fetchImpl, {
          apiKey,
          strategy,
          targetUrl: target.url,
        });
        results.push({
          label: target.label,
          strategy,
          url: target.url,
          ...evaluatePageSpeedResult(payload),
        });
      } catch (error) {
        results.push({
          failures: [
            {
              metric: 'request',
              actual: null,
              message: error instanceof Error ? error.message : String(error),
              threshold: 0,
            },
          ],
          label: target.label,
          passed: false,
          scores: EMPTY_PAGE_SPEED_SCORES,
          strategy,
          url: target.url,
          vitals: EMPTY_PAGE_SPEED_VITALS,
        });
      }
    }
  }
  return results;
}

function getCategoryScore(
  payload: PageSpeedApiResponse,
  key: keyof typeof CATEGORY_THRESHOLDS
): number | null {
  const score = payload.lighthouseResult?.categories?.[key]?.score;
  return typeof score === 'number' ? score : null;
}

function getAuditMetric(
  payload: PageSpeedApiResponse,
  key: string
): number | null {
  const numericValue = payload.lighthouseResult?.audits?.[key]?.numericValue;
  return typeof numericValue === 'number' ? numericValue : null;
}

function getFieldMetric(
  payload: PageSpeedApiResponse,
  key: string
): number | null {
  const metric =
    payload.loadingExperience?.metrics?.[key]?.percentile ??
    payload.originLoadingExperience?.metrics?.[key]?.percentile;
  return typeof metric === 'number' ? metric : null;
}

async function fetchPageSpeedPayload(
  fetchImpl: typeof fetch,
  options: Parameters<typeof pageSpeedShared.buildPsiUrl>[0]
): Promise<PageSpeedApiResponse> {
  const controller = new AbortController();
  const timeoutMs = resolveTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(pageSpeedShared.buildPsiUrl(options), {
      signal: controller.signal,
    });
    if (!response.ok) {
      const apiErrorDetails = await describePageSpeedApiError(response);
      throw new Error(
        `PageSpeed Insights request failed for ${options.targetUrl} (${options.strategy}) with status ${response.status}${apiErrorDetails ? `; ${apiErrorDetails}` : ''}`
      );
    }
    return (await response.json()) as PageSpeedApiResponse;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `PageSpeed Insights request timed out for ${options.targetUrl} (${options.strategy}) after ${timeoutMs}ms`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function describePageSpeedApiError(
  response: Response
): Promise<string | null> {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return null;
  }

  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  const descriptions: string[] = [];
  const status = readSafeApiToken(payload.error.status);
  if (status) {
    descriptions.push(`API status ${status}`);
  }

  const reasons = [payload.error.errors, payload.error.details]
    .filter(Array.isArray)
    .flat()
    .flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const reason = readSafeApiToken(entry.reason);
      return reason ? [reason] : [];
    });
  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length > 0) {
    descriptions.push(`reasons ${uniqueReasons.join(', ')}`);
  }

  return descriptions.length > 0 ? descriptions.join('; ') : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSafeApiToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return /^[A-Za-z0-9_.-]{1,80}$/.test(token) ? token : null;
}

function resolveTimeoutMs(): number {
  const rawValue = process.env.PAGE_SPEED_TIMEOUT_MS;
  if (!rawValue) return PAGE_SPEED_TIMEOUT_MS;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid PAGE_SPEED_TIMEOUT_MS value "${rawValue}". Expected a positive integer in milliseconds.`
    );
  }
  return parsed;
}

export const pageSpeedTools = {
  ...pageSpeedShared,
  evaluatePageSpeedResult,
  runPageSpeedAudit,
} as const;
