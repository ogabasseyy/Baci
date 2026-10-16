import { fetchWithCsrf } from '@/lib/api-client';
import { cartRoute, readBody } from './shared-cart-client';

/** Device-scoped revocation on sign-out; never clears the shared cart. */
export async function revokeCartDeviceSession(
  merchantSlug?: string | null
): Promise<{ ok: boolean }> {
  try {
    const response = await fetchWithCsrf(
      cartRoute('/api/storefront/cart/session/revoke', merchantSlug),
      {
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );
    const body = await readBody(response);
    // No proof means no cart authority exists to retire (ordinary
    // legacy logout). A definitively invalid proof (for example after
    // a signing-key rotation) can never be repaired by retrying and
    // authorizes nothing, so it is likewise already retired.
    return {
      ok: response.ok
        ? body?.revoked === true
        : response.status === 401 &&
          (body?.code === 'missing_proof' || body?.code === 'invalid_proof'),
    };
  } catch {
    return { ok: false };
  }
}
