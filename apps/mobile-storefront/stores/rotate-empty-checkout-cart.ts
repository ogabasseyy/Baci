import { persistCheckoutGeneration } from '@/lib/persist-checkout-generation';
import { emptyCheckoutCart } from './empty-checkout-cart';

export async function rotateEmptyCheckoutCart(
  apply: (next: ReturnType<typeof emptyCheckoutCart>) => void
) {
  const next = emptyCheckoutCart();
  apply(next);
  await persistCheckoutGeneration(next.checkoutGeneration);
  return next;
}
