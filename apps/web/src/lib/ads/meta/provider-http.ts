import 'server-only';

export const MAX_RETRIES = 3;
/**
 * Keep retry waits inside the synchronous route's request window. This is a
 * budget for the whole retry walk, rather than a cap that resets per attempt.
 */
export const MAX_RETRY_WAIT_BUDGET_MS = 10_000;
const RETRYABLE_META_CODES = new Set([4, 17, 613, 80000, 80003, 80004, 80014]);

export interface MetaAdsRetryBudget {
  remainingMs: number;
}

export function createMetaAdsRetryBudget(
  maxWaitMs = MAX_RETRY_WAIT_BUDGET_MS
): MetaAdsRetryBudget {
  return {
    remainingMs: Number.isFinite(maxWaitMs) && maxWaitMs >= 0 ? maxWaitMs : 0,
  };
}

export interface MetaAdsUsageTelemetry {
  adAccountCallCount: number | null;
  businessUseCaseCallCount: number | null;
  insightsThrottleResetSeconds: number | null;
}

export class MetaAdsProviderError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, status?: number) {
    super(code);
    this.code = code;
    this.name = 'MetaAdsProviderError';
    this.status = status;
  }
}

export function finiteNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function providerErrorCode(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' && Number.isInteger(code) ? code : null;
}

function parseUsageTelemetry(headers: Headers): MetaAdsUsageTelemetry | null {
  const parseObject = (name: string): Record<string, unknown> | null => {
    const header = headers.get(name);
    if (!header) return null;
    try {
      const parsed: unknown = JSON.parse(header);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const adAccount = parseObject('x-ad-account-usage');
  const businessUseCase = parseObject('x-business-use-case-usage');
  const throttle = parseObject('x-fb-ads-insights-throttle');
  const adsInsights = businessUseCase?.ads_insights;
  const businessEntry = Array.isArray(adsInsights) ? adsInsights[0] : null;
  const retryAfter = finiteNonNegativeNumber(headers.get('retry-after'));
  const telemetry = {
    adAccountCallCount: finiteNonNegativeNumber(adAccount?.call_count),
    businessUseCaseCallCount: finiteNonNegativeNumber(
      businessEntry && typeof businessEntry === 'object'
        ? (businessEntry as Record<string, unknown>).call_count
        : null
    ),
    insightsThrottleResetSeconds:
      finiteNonNegativeNumber(throttle?.estimated_time_to_regain_access) ??
      retryAfter,
  };
  return Object.values(telemetry).some((value) => value !== null)
    ? telemetry
    : null;
}

export async function fetchMetaJson(
  url: URL,
  accessToken: string,
  failureCode: string,
  fetchImpl: typeof fetch,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onTelemetry?: (telemetry: MetaAdsUsageTelemetry) => void,
  retryBudget: MetaAdsRetryBudget = createMetaAdsRetryBudget()
): Promise<unknown> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const telemetry = parseUsageTelemetry(response.headers);
    if (telemetry) onTelemetry?.(telemetry);
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // Provider bodies are intentionally discarded.
    }
    if (response.ok) return payload;
    const metaCode = providerErrorCode(payload);
    if (response.status === 401 || metaCode === 190) {
      throw new MetaAdsProviderError(
        'META_ADS_ACCESS_REVOKED',
        response.status
      );
    }
    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      RETRYABLE_META_CODES.has(metaCode ?? -1);
    const throttled =
      response.status === 429 || RETRYABLE_META_CODES.has(metaCode ?? -1);
    const terminalCode = throttled ? 'META_ADS_THROTTLED' : failureCode;
    if (!retryable || attempt === MAX_RETRIES - 1) {
      throw new MetaAdsProviderError(terminalCode, response.status);
    }
    const resetHintMs = (telemetry?.insightsThrottleResetSeconds ?? 0) * 1000;
    const delayMs = Math.max(250 * 2 ** attempt, resetHintMs);
    const remainingWaitMs =
      Number.isFinite(retryBudget.remainingMs) && retryBudget.remainingMs > 0
        ? retryBudget.remainingMs
        : 0;
    if (delayMs > remainingWaitMs)
      throw new MetaAdsProviderError(terminalCode, response.status);
    const waitStartedAt = Date.now();
    await sleep(delayMs);
    const elapsedWaitMs = Math.max(delayMs, Date.now() - waitStartedAt);
    retryBudget.remainingMs = Math.max(0, remainingWaitMs - elapsedWaitMs);
  }
  throw new MetaAdsProviderError(failureCode);
}
