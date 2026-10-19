import { createTimeoutComposedFetch } from '@/lib/supabase/compose-fetch-signal';
import { createStorefrontBuildReadFetch } from './storefront-build-read-fetch';

const RUNTIME_PUBLIC_READ_TIMEOUT_MS = 10_000;
const BUILD_PUBLIC_READ_TIMEOUT_MS = 30_000;
const OFFLINE_BUILD_RESPONSE = {
  message: 'Storefront reads are disabled for this build',
};

function createOfflineBuildFetch() {
  return (async () =>
    Response.json(OFFLINE_BUILD_RESPONSE, {
      status: 503,
    })) satisfies typeof fetch;
}

function createNonRetryingBuildTimeoutFetch(timeoutMs: number) {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    try {
      return await fetch(input, { ...init, signal });
    } catch (error) {
      if (timeoutSignal.aborted && !init.signal?.aborted) {
        throw new DOMException('Storefront build read timed out', 'AbortError');
      }

      throw error;
    }
  };
}

/** Builds the shared anonymous-read transport for cached and prerendered storefront data. */
export function createStorefrontPublicReadFetch(timeoutMs?: number) {
  const buildReadMode = process.env.BACI_STOREFRONT_BUILD_READS;
  if (buildReadMode === 'offline') return createOfflineBuildFetch();

  const isBoundedBuild = buildReadMode === 'bounded';
  const effectiveTimeoutMs =
    timeoutMs ??
    (isBoundedBuild
      ? BUILD_PUBLIC_READ_TIMEOUT_MS
      : RUNTIME_PUBLIC_READ_TIMEOUT_MS);
  return isBoundedBuild
    ? createStorefrontBuildReadFetch(
        createNonRetryingBuildTimeoutFetch(effectiveTimeoutMs)
      )
    : createTimeoutComposedFetch(effectiveTimeoutMs);
}
