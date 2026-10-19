import type { CartPrincipal } from './principal';
import { createCartRevocationClient } from './scoped-client';

interface Client {
  rpc(
    name: 'commerce_cart_revoke_device_grants'
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export async function revokeCartDeviceGrants(
  principal: CartPrincipal,
  client?: Client
): Promise<
  { ok: true } | { ok: false; code: 'unauthorized' | 'temporarily_unavailable' }
> {
  if (
    (principal.scope === 'session' &&
      (!principal.cartId || !principal.grantId)) ||
    !Number.isFinite(Date.parse(principal.expiresAt))
  )
    return { ok: false, code: 'unauthorized' };
  try {
    const { data, error } = await (
      client ?? createCartRevocationClient(principal)
    ).rpc('commerce_cart_revoke_device_grants');
    if (error || !data || typeof data !== 'object' || !('ok' in data))
      return { ok: false, code: 'temporarily_unavailable' };
    return data.ok === true
      ? { ok: true }
      : { ok: false, code: 'unauthorized' };
  } catch {
    return { ok: false, code: 'temporarily_unavailable' };
  }
}
