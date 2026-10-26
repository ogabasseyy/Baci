import type { CartSnapshot } from '@baci/shared/cart';
import { fetchDestinationCart } from './cart-handoff-destination';

export interface DestinationLoaderDeps {
  bootstrapRequired: { current: boolean };
  setDestCart: (cart: CartSnapshot | null) => void;
  setDestChecked: (checked: boolean) => void;
  setDestinationError: (error: string | null) => void;
}

/** Load the destination cart for a handoff preview into hook state. */
export async function loadDestinationCart(
  deps: DestinationLoaderDeps,
  slug: string | null,
  signal?: AbortSignal
): Promise<void> {
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
  deps.bootstrapRequired.current = result.bootstrapRequired;
  deps.setDestCart(result.cart);
  deps.setDestChecked(true);
}
