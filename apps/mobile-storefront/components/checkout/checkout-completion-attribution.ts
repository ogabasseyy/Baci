import type { CheckoutCompletionAttribution } from '@/services/track-checkout-payment-completed-once';
import type { CartItem } from '@/stores/cart-store';

interface CheckoutSnapshotLike {
  deliveryFee: number;
  subtotal: number;
  taxAmount: number;
}

// Snapshots the checkout identity and canonical breakdown for deferred
// purchase completion. Guests have no cached auth identity, so the form
// values must travel with the completion; the snapshot breakdown keeps
// shipping/tax analytics dimensions accurate.
export function buildCheckoutCompletionAttribution({
  customerEmail,
  customerPhone,
  userId,
  items,
  snapshot,
}: {
  customerEmail: string;
  customerPhone: string;
  userId?: string;
  items: CartItem[];
  snapshot: CheckoutSnapshotLike;
}): CheckoutCompletionAttribution {
  return {
    customerEmail,
    customerPhone,
    items,
    shipping: snapshot.deliveryFee,
    subtotal: snapshot.subtotal,
    tax: snapshot.taxAmount,
    userId,
  };
}
