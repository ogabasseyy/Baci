import { sharedCartCheckoutReady } from './checkout-ready';

export interface CheckoutCartState {
  enabled: boolean;
  status?: string;
  metadataReady?: boolean;
  snapshot?: { state: string; lines: readonly unknown[] } | null;
  prepare: (() => Promise<void>) | null;
  refresh: (() => Promise<void>) | null;
}
export type CheckoutPreparation =
  | { ready: true }
  | {
      ready: false;
      reason: 'choice_required' | 'unavailable' | 'session_changed';
    };

/** Checkout is an explicit intent to import saved lines; never bypass its review. */
export async function prepareCartCheckout(
  getState: () => CheckoutCartState
): Promise<CheckoutPreparation> {
  const initial = getState();
  if (sharedCartCheckoutReady(initial)) return { ready: true };
  if (initial.status === 'choice_required')
    return { ready: false, reason: 'choice_required' };
  // A refresh alone cannot create a missing cart. Conversely, prepare can
  // return an existing snapshot without retrying its failed product hydration.
  const operation = initial.snapshot ? initial.refresh : initial.prepare;
  if (!operation) return { ready: false, reason: 'unavailable' };
  const replaced = () => {
    const current = getState();
    return (
      current.enabled !== initial.enabled ||
      current.prepare !== initial.prepare ||
      current.refresh !== initial.refresh
    );
  };
  try {
    await operation();
    if (replaced()) return { ready: false, reason: 'session_changed' };
    const observed = getState();
    if (
      !initial.snapshot &&
      observed.snapshot &&
      !observed.metadataReady &&
      observed.status !== 'choice_required' &&
      ['active', 'checkout'].includes(observed.snapshot.state) &&
      observed.refresh
    ) {
      // One hydration retry only; never loop, switch carts, or re-create.
      await observed.refresh();
    }
  } catch {
    if (replaced()) return { ready: false, reason: 'session_changed' };
    const current = getState();
    // A sync can publish a checkout-ready snapshot and then fail a later
    // re-read; the published cart is still usable for checkout.
    if (sharedCartCheckoutReady(current)) return { ready: true };
    return {
      ready: false,
      reason:
        current.status === 'choice_required'
          ? 'choice_required'
          : 'unavailable',
    };
  }
  const current = getState();
  if (replaced()) return { ready: false, reason: 'session_changed' };
  if (sharedCartCheckoutReady(current)) return { ready: true };
  return {
    ready: false,
    reason:
      current.status === 'choice_required' ? 'choice_required' : 'unavailable',
  };
}
