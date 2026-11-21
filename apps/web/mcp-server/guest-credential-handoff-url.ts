import {
  cartHandoffPairingTokenSchema,
  cartHandoffPreviewQuerySchema,
} from '../src/schemas/cart';
import { canonicalBridgeAllowedOrigins } from './guest-cart-canonical-bridge';
import {
  GuestCartCanonicalError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';

const signedHandoffTokenSchema = cartHandoffPairingTokenSchema.regex(
  /^ch1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
);

/** Preserve the exact broker URL. A legacy item snapshot cannot be imported safely. */
export function guestCredentialHandoffUrl(cart: {
  cart_token: string;
  items: readonly unknown[];
  version?: number;
  canonical_cart_id?: string;
  cart_url?: string;
}): string {
  const handoff = cart.cart_url;
  const url = handoff ? URL.parse(handoff) : null;
  const fragment = new URLSearchParams(url?.hash.slice(1));
  const allowedOrigins = canonicalBridgeAllowedOrigins();
  if (!cart.canonical_cart_id || !cart.version)
    throw new GuestCartStorageUnavailableError('Canonical cart unavailable');
  if (!cart.items.length) {
    if (
      !handoff ||
      url?.protocol !== 'https:' ||
      !allowedOrigins.includes(url.origin) ||
      handoff !== new URL('/cart', url.origin).href
    ) {
      throw new GuestCartStorageUnavailableError('Storefront cart URL unavailable');
    }
    return handoff;
  }
  if (
    !handoff ||
    url?.protocol !== 'https:' ||
    !allowedOrigins.includes(url.origin) ||
    url.username ||
    url.password ||
    url.pathname !== '/cart' ||
    url.search ||
    fragment.size !== 2 ||
    url.href !== handoff ||
    !signedHandoffTokenSchema.safeParse(fragment.get('handoff')).success ||
    !cartHandoffPreviewQuerySchema.safeParse({ handoff_id: fragment.get('hid') })
      .success
  ) {
    throw new GuestCartCanonicalError(
      'refresh_required',
      cart.cart_token,
      cart.canonical_cart_id,
      cart.version
    );
  }
  return handoff;
}
