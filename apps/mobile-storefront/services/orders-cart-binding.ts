import type { CartCheckoutBinding } from '@/schemas/cart-checkout-binding';
/** A canonical device cart cannot fall through to legacy order creation on an error. */
export function cartBindingMatchesCurrentDevice(
  binding: CartCheckoutBinding | undefined,
  current: { merchantId: string; cartId: string } | undefined,
  merchantId: string
): boolean {
  return (
    !current ||
    (current.merchantId === merchantId && binding?.cart_id === current.cartId)
  );
}
