import type { CartPrincipal } from './principal';
import {
  createCartScopedClient,
  issueCartReceiveAccess,
} from './scoped-client';

interface RealtimeAccessDeps {
  now?: Date;
  authorize: () => PromiseLike<{ data: unknown; error: unknown }>;
  issue: (principal: CartPrincipal) => { token: string; expiresAt: string };
}
export type CartRealtimeAccess =
  | { ok: true; topic: string; token: string; expiresAt: string }
  | {
      ok: false;
      code: 'unauthorized' | 'not_found' | 'temporarily_unavailable';
    };

/** Rechecks live grant/merchant enrollment before minting receive-only authority. */
export async function getCartRealtimeAccess(
  principal: CartPrincipal,
  deps: RealtimeAccessDeps = {
    authorize: () =>
      createCartScopedClient(principal).rpc('commerce_cart_realtime_access'),
    issue: issueCartReceiveAccess,
  }
): Promise<CartRealtimeAccess> {
  const now = (deps.now ?? new Date()).getTime();
  if (
    principal.scope !== 'session' ||
    !principal.cartId ||
    !principal.grantId ||
    !(Date.parse(principal.expiresAt) > now)
  )
    return { ok: false, code: 'unauthorized' };
  try {
    const { data, error } = await deps.authorize();
    if (error) return { ok: false, code: 'temporarily_unavailable' };
    if (typeof data !== 'object' || data === null)
      return { ok: false, code: 'temporarily_unavailable' };
    const result = data as Record<string, unknown>;
    if (result.ok !== true) return { ok: false, code: 'not_found' };
    const topic = `cart:${principal.merchantId}:${principal.cartId}`;
    if (result.topic !== topic || typeof result.expiresAt !== 'string')
      return { ok: false, code: 'unauthorized' };
    const expiry = Math.min(
      Date.parse(principal.expiresAt),
      Date.parse(result.expiresAt)
    );
    if (!(expiry > now)) return { ok: false, code: 'unauthorized' };
    const issued = deps.issue({
      ...principal,
      expiresAt: new Date(expiry).toISOString(),
    });
    return { ok: true, topic, ...issued };
  } catch {
    return { ok: false, code: 'temporarily_unavailable' };
  }
}
