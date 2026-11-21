import type { CartSnapshot } from '@baci/shared/cart';
import {
  type DestinationLoad,
  fetchDestinationCart,
} from './cart-handoff-destination';
import {
  clearActiveHandoff,
  lockedAttemptChoice,
} from './cart-handoff-support';

export interface DestinationLoaderDeps {
  bootstrapRequired: { current: boolean };
  setDestCart: (cart: CartSnapshot | null) => void;
  setDestChecked: (checked: boolean) => void;
  setDestinationError: (error: string | null) => void;
  incoming?: { cart: CartSnapshot; handoffId: string };
}

/** Both channels already use this cart. Opening it needs no grant or write. */
function openAlreadySharedCart(
  destination: CartSnapshot | null,
  incoming: DestinationLoaderDeps['incoming']
): boolean {
  if (
    !destination ||
    !incoming ||
    destination.cartId !== incoming.cart.cartId ||
    destination.merchantId !== incoming.cart.merchantId ||
    lockedAttemptChoice(incoming.handoffId)
  ) {
    return false;
  }
  clearActiveHandoff(incoming.handoffId);
  window.location.replace(window.location.pathname + window.location.search);
  return true;
}

/** Load the destination cart for a handoff preview into hook state. */
export async function loadDestinationCart(
  deps: DestinationLoaderDeps,
  slug: string | null,
  signal?: AbortSignal
): Promise<Extract<DestinationLoad, { status: 'checked' }> | undefined> {
  deps.setDestChecked(false);
  deps.setDestinationError(null);
  const result = await fetchDestinationCart(slug, signal);
  // An aborted refresh here is the bounded deadline expiring (the
  // only signal source): surface a retryable destination error
  // instead of stranding the screen on its loading state.
  if (signal?.aborted) {
    deps.setDestChecked(true);
    deps.setDestinationError(
      'Could not check your existing cart. Please try again.'
    );
    return;
  }
  if (result.status === 'error') {
    deps.setDestChecked(true);
    deps.setDestinationError(
      'Could not check your existing cart. Please try again.'
    );
    return;
  }
  if (openAlreadySharedCart(result.cart, deps.incoming)) return;
  deps.bootstrapRequired.current = result.bootstrapRequired;
  deps.setDestCart(result.cart);
  deps.setDestChecked(true);
  return result;
}
