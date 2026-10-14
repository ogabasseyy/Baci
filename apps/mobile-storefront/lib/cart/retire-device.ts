import { NativeCartError } from './native-cart-error';
import type { CartSessionStorage } from './session-storage';
import type { CartFetch, NativeCartConfig } from './shared-cart-client';

/** The retained proof can only retire authority. It never re-enters the active cart context. */
export async function flushRetiredCartDevice(
  config: NativeCartConfig,
  storage: CartSessionStorage,
  fetcher: CartFetch
): Promise<void> {
  const base = new URL(config.apiOrigin);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new NativeCartError('invalid_configuration');
  const proof = await storage.getRetiredProof?.(config.merchantId);
  if (!proof) return;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetcher(
      `${base.origin}/api/storefront/cart/session/revoke?merchantSlug=${encodeURIComponent(config.merchantSlug)}`,
      {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: abort.signal,
        headers: {
          Authorization: `Bearer ${proof}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }
    );
    const result: unknown = await response.json();
    if (
      !response.ok ||
      !result ||
      typeof result !== 'object' ||
      !('revoked' in result) ||
      result.revoked !== true
    )
      throw new NativeCartError('revocation_pending');
    await storage.acknowledgeRetirement?.(config.merchantId, proof);
  } catch {
    throw new NativeCartError('revocation_pending');
  } finally {
    clearTimeout(timer);
  }
}
