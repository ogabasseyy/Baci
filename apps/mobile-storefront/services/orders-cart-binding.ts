import { readOwnedCartProof } from '@/lib/cart/owned-session';
import { readNativeCartContext } from '@/lib/cart/session-context';
import { cartSessionStorage } from '@/lib/cart/session-storage';
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

/**
 * Reads the device cart proof for a bound submit. The orders route
 * verifies it server-side and binds the order to the preparing
 * principal; a proof for another cart is never attached.
 */
export async function readSharedCartOrderProof(
  binding: CartCheckoutBinding | undefined,
  merchantId: string,
  ownerSubject?: string
): Promise<string | undefined> {
  if (!binding) return undefined;
  try {
    const proof = await readOwnedCartProof(
      cartSessionStorage,
      merchantId.toLowerCase(),
      ownerSubject
    );
    if (!proof) return undefined;
    return readNativeCartContext(proof, merchantId).cartId === binding.cart_id
      ? proof
      : undefined;
  } catch {
    return undefined;
  }
}
