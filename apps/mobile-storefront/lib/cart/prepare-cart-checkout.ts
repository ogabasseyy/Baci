import { sharedCartCheckoutReady } from './checkout-ready';

export interface CheckoutCartState {
  enabled: boolean;
  status?: string;
  metadataReady?: boolean;
  mergeConflicts?: readonly unknown[];
  snapshot?: {
    state: string;
    lines: readonly unknown[];
    cartId?: string;
    version?: number;
  } | null;
  prepare: (() => Promise<void>) | null;
  refresh: (() => Promise<void>) | null;
}
export type CheckoutPreparation =
  | { ready: true }
  | {
      ready: false;
      reason:
        | 'choice_required'
        | 'unavailable'
        | 'session_changed'
        | 'cart_changed';
    };

/** Checkout is an explicit intent to import saved lines; never bypass its review. */
export async function prepareCartCheckout(
  getState: () => CheckoutCartState
): Promise<CheckoutPreparation> {
  const initial = getState();
  if (!initial.enabled) return { ready: true };
  if (sharedCartCheckoutReady(initial) && !initial.refresh)
    return { ready: true };
  // Already-ready carts still verify through the refresh below so an
  // in-flight poll cannot publish a different cart under checkout.
  if (
    initial.status === 'choice_required' ||
    (initial.mergeConflicts?.length ?? 0) > 0
  )
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
  let baseline = initial.snapshot;
  try {
    await operation();
    if (replaced()) return { ready: false, reason: 'session_changed' };
    const observed = getState();
    // On the create/import path the prepared snapshot becomes the
    // reviewed baseline for the version fence below.
    if (!baseline && observed.snapshot) baseline = observed.snapshot;
    if (replaced()) return { ready: false, reason: 'session_changed' };
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
    // serial() flips status to 'error' on any rejection, so a failed sync
    // is never checkout-ready here; the shopper retries explicitly.
    const failed = getState();
    return {
      ready: false,
      reason:
        failed.status === 'choice_required' ||
        (failed.mergeConflicts?.length ?? 0) > 0
          ? 'choice_required'
          : 'unavailable',
    };
  }
  const current = getState();
  if (replaced()) return { ready: false, reason: 'session_changed' };
  // A polling/foreground refresh can publish a different canonical cart
  // mid-preparation; the shopper must review that version before checkout.
  if (
    baseline &&
    current.snapshot &&
    (current.snapshot.cartId !== baseline.cartId ||
      current.snapshot.version !== baseline.version)
  )
    return { ready: false, reason: 'cart_changed' };
  if ((current.mergeConflicts?.length ?? 0) > 0)
    return { ready: false, reason: 'choice_required' };
  if (sharedCartCheckoutReady(current)) return { ready: true };
  return {
    ready: false,
    reason:
      current.status === 'choice_required' ? 'choice_required' : 'unavailable',
  };
}
