import type { CartErrorCode } from '@baci/shared/cart';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  isCartSessionRetiring,
  runBoundedCartSessionWrite,
} from './cart-session-write-fence';
import { failureOf, readBody } from './shared-cart-client-support';
import {
  ensureCartDeviceRevocationCleared,
  isCartDeviceRevocationPending,
} from './shared-cart-session-revoke-client';

/**
 * Mints a bounded anonymous retry identity for one merchant. The server
 * sets the session cookie; the body proof is only needed by callers
 * that cannot rely on cookies.
 */
type BootstrapResult =
  | { ok: true }
  | { ok: false; code: CartErrorCode; retryable: boolean };

const inFlightBootstraps = new Map<string, Promise<BootstrapResult>>();

/**
 * Bootstrap is single-flight per resolved merchant: two concurrent
 * bootstraps can both leave without a live-session cookie, and
 * whichever Set-Cookie lands last wins — a cart-less bootstrap proof
 * arriving after provisioning would overwrite the proof bound to the
 * just-created cart and orphan it. Callers do not all name the
 * merchant the same way. Coalesce only identical keys: an unnamed
 * host-resolved caller cannot safely infer a named flight's merchant.
 * The origin-wide write lock serializes distinct physical requests.
 */
export function bootstrapSharedCart(
  merchantSlug?: string
): Promise<BootstrapResult> {
  const unavailable: BootstrapResult = {
    code: 'temporarily_unavailable',
    ok: false,
    retryable: true,
  };
  if (isCartSessionRetiring(merchantSlug)) return Promise.resolve(unavailable);
  const key = merchantSlug ?? '';
  const existing = inFlightBootstraps.get(key);
  if (existing) return existing;
  const pending = runBoundedCartSessionWrite<BootstrapResult>(
    merchantSlug,
    { code: 'temporarily_unavailable', ok: false, retryable: true },
    (signal) => requestBootstrap(merchantSlug, signal),
    undefined,
    isCartDeviceRevocationPending(merchantSlug)
      ? (signal) => ensureCartDeviceRevocationCleared(merchantSlug, signal)
      : undefined
  ).finally(() => {
    if (inFlightBootstraps.get(key) === pending) inFlightBootstraps.delete(key);
  });
  inFlightBootstraps.set(key, pending);
  return pending;
}

async function requestBootstrap(
  merchantSlug?: string,
  signal?: AbortSignal
): Promise<BootstrapResult> {
  if (isCartDeviceRevocationPending(merchantSlug)) {
    return { code: 'temporarily_unavailable', ok: false, retryable: true };
  }
  let response: Response;
  try {
    response = await fetchWithCsrf('/api/storefront/cart/bootstrap', {
      body: JSON.stringify(merchantSlug ? { merchantSlug } : {}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    });
  } catch {
    return { code: 'temporarily_unavailable', ok: false, retryable: true };
  }
  if (response.ok) return { ok: true };
  const body = await readBody(response);
  const failure = failureOf(body, response.status);
  return { code: failure.code, ok: false, retryable: failure.retryable };
}
