import { isConfirmedImeiRefund } from '@baci/shared/imei';
import { ImeiCheckApiResponseSchema, type ImeiResult } from './validation';

export type ImeiPollOutcome =
  | { kind: 'complete'; result: ImeiResult }
  | { confirmedRefund?: boolean; error: string; kind: 'error' }
  | { kind: 'pending'; pollAfterMs: number }
  | { kind: 'retry'; pollAfterMs: number };

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
    const code =
      typeof raw === 'object' &&
      raw !== null &&
      'code' in raw &&
      typeof raw.code === 'string'
        ? raw.code
        : undefined;
    return {
      ...(isConfirmedImeiRefund(response.status, code)
        ? { confirmedRefund: true }
        : {}),
      error: data.error ?? 'Unable to complete this IMEI check.',
      kind: 'error',
    };
  } catch {
    return { kind: 'retry', pollAfterMs: 10_000 };
  } finally {
    clearTimeout(timeout);
  }
}
