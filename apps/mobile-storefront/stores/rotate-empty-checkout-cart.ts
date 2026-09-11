import { persistCheckoutGeneration } from '@/lib/persist-checkout-generation';
import { emptyCheckoutCart } from './empty-checkout-cart';

export async function rotateEmptyCheckoutCart() {
  const next = emptyCheckoutCart();
  await persistCheckoutGeneration(next.checkoutGeneration);
  return next;
}
