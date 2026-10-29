import { cartRoute } from '@/hooks/cart/shared-cart-client-support';
import { readRedvaultUncertainAttempt } from '../redvault-uncertain-attempt';

type Attempt = Extract<
  ReturnType<typeof readRedvaultUncertainAttempt>,
  { kind: 'pending' }
>['attempt'];

/** The server either closes this exact session or returns its existing order. */
export async function reconcileRedvaultUncertainAttempt({
  attempt,
  merchantSlug,
  request,
  signal,
}: {
  attempt: Attempt;
  merchantSlug?: string | null;
  request: (url: string, init?: RequestInit) => Promise<Response>;
  signal: AbortSignal;
}): Promise<
  | { kind: 'retired' }
  | { kind: 'submitted'; payload: unknown }
  | { kind: 'unavailable' }
> {
  const binding = attempt.parsedOrder.shared_cart;
  if (!binding) return { kind: 'unavailable' };
  try {
    const response = await request(
      cartRoute('/api/storefront/cart/checkout/reconcile', merchantSlug),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          cartId: binding.cart_id,
          sessionId: binding.checkout_session_id,
          generation: binding.checkout_generation,
          cartVersion: binding.cart_version,
          customerEmail: attempt.customer.email,
          idempotencyKey: attempt.idempotencyKey,
        }),
      }
    );
    if (!response.ok || signal.aborted) return { kind: 'unavailable' };
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') return { kind: 'unavailable' };
    const result = data as Record<string, unknown>;
    if (
      result.kind === 'retired' &&
      result.cartId === binding.cart_id &&
      result.checkoutSessionId === binding.checkout_session_id &&
      result.checkoutGeneration === binding.checkout_generation
    )
      return { kind: 'retired' };
    if (result.kind === 'submitted')
      return { kind: 'submitted', payload: data };
  } catch {
    // Preserve the attempt whenever the server cannot confirm the outcome.
  }
  return { kind: 'unavailable' };
}
