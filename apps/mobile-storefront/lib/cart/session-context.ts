import { nativeCartContextSchema } from '@/schemas/cart-context';
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
  const encoded = proof.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
  const value: unknown = JSON.parse(
    decodeURIComponent(
      Array.from(
        bytes,
        (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`
      ).join('')
    )
  );
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
