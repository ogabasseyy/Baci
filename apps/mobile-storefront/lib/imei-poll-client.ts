import { ImeiCheckApiResponseSchema, type ImeiResult } from './validation';

export type ImeiPollOutcome =
  | { kind: 'complete'; result: ImeiResult }
  | { error: string; kind: 'error' }
  | { kind: 'pending'; pollAfterMs: number }
  | { kind: 'retry'; pollAfterMs: number };

const isTransientStatus = (status: number) =>
  status === 401 || status === 408 || status === 429 || status >= 500;

export async function pollImeiLookup({
  accessToken,
  apiBaseUrl,
  fetchImpl = fetch,
  lookupId,
}: {
  accessToken?: string;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  lookupId: string;
}): Promise<ImeiPollOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetchImpl(
      `${apiBaseUrl.replace(/\/$/, '')}/api/storefront/imei-check/${encodeURIComponent(lookupId)}`,
      {
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
        method: 'GET',
        signal: controller.signal,
      }
    );
    const raw = await response.json();
    const parsed = ImeiCheckApiResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return { kind: 'retry', pollAfterMs: 10_000 };
    }

    const data = parsed.data;
    // A settled lookup always comes back with its lookupId (the cached
    // result). Without one, an auth, rate-limit or server failure says
    // nothing about the paid lookup: it keeps polling, so its record and
    // saved key are not retired before the server reports a final result.
    if (!data.lookupId && isTransientStatus(response.status)) {
      return { kind: 'retry', pollAfterMs: 10_000 };
    }
    if (response.status === 202 && data.status === 'pending' && data.success) {
      return { kind: 'pending', pollAfterMs: data.pollAfterMs ?? 5_000 };
    }
    if (
      response.ok &&
      data.status === 'complete' &&
      data.success &&
      data.data
    ) {
      return { kind: 'complete', result: data.data };
    }
    return {
      error: data.error ?? 'Unable to complete this IMEI check.',
      kind: 'error',
    };
  } catch {
    return { kind: 'retry', pollAfterMs: 10_000 };
  } finally {
    clearTimeout(timeout);
  }
}
