import type { CartState } from './cart-store-state';
export function mergeCartStore(
  persisted: unknown,
  current: CartState,
  merchantId: string,
  owned: boolean
): CartState {
  if (owned || !persisted || typeof persisted !== 'object') return current;
  const value = persisted as Record<string, unknown>;
  let sharedCartRef: CartState['sharedCartRef'];
  if (value.sharedCartRef !== undefined) {
    const ref = value.sharedCartRef;
    if (
      !ref ||
      typeof ref !== 'object' ||
      !('merchantId' in ref) ||
      typeof ref.merchantId !== 'string' ||
      !('cartId' in ref) ||
      typeof ref.cartId !== 'string' ||
      !merchantId ||
      ref.merchantId.toLowerCase() !== merchantId.toLowerCase()
    )
      return current;
    sharedCartRef = { merchantId: ref.merchantId, cartId: ref.cartId };
  }
  return {
    ...current,
    ...(Array.isArray(value.items)
      ? { items: value.items as CartState['items'] }
      : {}),
    ...(typeof value.checkoutGeneration === 'string'
      ? { checkoutGeneration: value.checkoutGeneration }
      : {}),
    ...(typeof value.cartWideNegotiationActive === 'boolean'
      ? { cartWideNegotiationActive: value.cartWideNegotiationActive }
      : {}),
    ...(typeof value.lineSequence === 'number' &&
    Number.isSafeInteger(value.lineSequence) &&
    value.lineSequence >= 0
      ? { lineSequence: value.lineSequence }
      : {}),
    ...(sharedCartRef ? { sharedCartRef } : {}),
  };
}
