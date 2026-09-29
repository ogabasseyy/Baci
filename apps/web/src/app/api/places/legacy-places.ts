/**
 * Shared client for Google Places API (Legacy) JSON endpoints.
 * Retries transient failures with exponential backoff: network errors and
 * HTTP 200 responses with an UNKNOWN_ERROR status (Google documents this as
 * a server-side error where trying again may be successful).
 */

const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 500;
const TRANSIENT_LEGACY_STATUS = 'UNKNOWN_ERROR';

export type LegacyPlacesResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number };

function isRetryableNetworkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('ECONNRESET') ||
      error.message.includes('fetch failed') ||
      error.message.includes('socket'))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchLegacyPlacesJson<T extends { status?: string }>(
  url: string
): Promise<LegacyPlacesResult<T>> {
  let retries = MAX_RETRIES;
  let delay = INITIAL_RETRY_DELAY_MS;

  for (;;) {
    let response: Response;
    try {
      response = await fetch(url, {
        // Legacy Places requires the API key in the query string. Keep the
        // credential-bearing URL out of exported fetch spans.
        opentelemetry: { ignore: true },
      });
    } catch (error: unknown) {
      if (isRetryableNetworkError(error) && retries > 0) {
        retries -= 1;
        console.warn(
          `[Places API] Fetch failed, retrying... (${retries} left)`
        );
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    const data = (await response.json()) as T;
    if (data.status === TRANSIENT_LEGACY_STATUS && retries > 0) {
      retries -= 1;
      console.warn(`[Places API] UNKNOWN_ERROR, retrying... (${retries} left)`);
      await sleep(delay);
      delay *= 2;
      continue;
    }

    return { ok: true, status: response.status, data };
  }
}
