import 'server-only';

import { snapchatAdsProviderRateLimiter } from './rate-limit';

const MAX_RETRIES = 3;
/**
 * Keep retry waits inside the synchronous route's request window. This is a
 * budget for the whole retry walk, rather than a cap that resets per attempt.
 */
export const MAX_RETRY_WAIT_BUDGET_MS = 10_000;

export interface SnapchatAdsRetryBudget {
  remainingMs: number;
}

export function createSnapchatAdsRetryBudget(
  maxWaitMs = MAX_RETRY_WAIT_BUDGET_MS
): SnapchatAdsRetryBudget {
  return {
    remainingMs: Number.isFinite(maxWaitMs) && maxWaitMs >= 0 ? maxWaitMs : 0,
  };
}

export class SnapchatAdsProviderError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number
  ) {
    super(code);
    this.name = 'SnapchatAdsProviderError';
  }
}
function retryDelay(response: Response, attempt: number, random: () => number) {
  const hinted = Number(response.headers.get('retry-after'));
  const exponential = 250 * 2 ** attempt;
  return Math.max(
    Number.isFinite(hinted) ? hinted * 1000 : 0,
    exponential + Math.floor(exponential * Math.max(0, Math.min(1, random())))
  );
}
export async function requestSnapchatAdsJson(
  url: URL,
  init: RequestInit,
  failureCode: string,
  fetchImpl: typeof fetch = fetch,
  options: {
    random?: () => number;
    retryBudget?: SnapchatAdsRetryBudget;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {}
): Promise<unknown> {
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const retryBudget = options.retryBudget ?? createSnapchatAdsRetryBudget();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    await snapchatAdsProviderRateLimiter.acquire();
    const response = await fetchImpl(url, init);
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      /* discard provider body */
    }
    // A 401 indicates an invalid or expired token. A 403 can be a valid token
    // without the Reports role, account access, or app activation; keep it as
    // an operation failure so callers do not incorrectly force reauth.
    if (response.status === 401)
      throw new SnapchatAdsProviderError(
        'SNAPCHAT_ADS_ACCESS_REVOKED',
        response.status
      );
    if (response.ok) return payload;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES - 1)
      throw new SnapchatAdsProviderError(
        response.status === 429 ? 'SNAPCHAT_ADS_THROTTLED' : failureCode,
        response.status
      );
    const delayMs = retryDelay(response, attempt, random);
    const remainingWaitMs =
      Number.isFinite(retryBudget.remainingMs) && retryBudget.remainingMs > 0
        ? retryBudget.remainingMs
        : 0;
    if (delayMs > remainingWaitMs)
      throw new SnapchatAdsProviderError(
        response.status === 429 ? 'SNAPCHAT_ADS_THROTTLED' : failureCode,
        response.status
      );
    const waitStartedAt = Date.now();
    await sleep(delayMs);
    const elapsedWaitMs = Math.max(delayMs, Date.now() - waitStartedAt);
    retryBudget.remainingMs = Math.max(0, remainingWaitMs - elapsedWaitMs);
  }
  throw new SnapchatAdsProviderError(failureCode);
}
