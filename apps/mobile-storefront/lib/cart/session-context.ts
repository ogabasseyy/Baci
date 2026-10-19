import { nativeCartContextSchema } from '@/schemas/cart-context';
import { decodeBase64UrlToUtf8 } from './base64url';
/** Unverified metadata is only a local replay fence. The server verifies all authority. */
export function readNativeCartContext(
  proof: string,
  merchantId: string,
  now = Date.now()
): { actor: string; cartId: string | null } {
  if (
    !/^cp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(proof) ||
    proof.length > 8192
  )
    throw new Error('Cart proof unavailable');
  const value: unknown = JSON.parse(decodeBase64UrlToUtf8(proof.split('.')[1]));
  const result = nativeCartContextSchema.parse(value);
  if (
    result.merchantId.toLowerCase() !== merchantId.toLowerCase() ||
    result.exp * 1000 <= now ||
    (result.scope === 'bootstrap' && result.cartId !== null) ||
    (result.scope === 'session' && result.cartId === null)
  )
    throw new Error('Cart proof unavailable');
  return { actor: result.principalId, cartId: result.cartId };
}
