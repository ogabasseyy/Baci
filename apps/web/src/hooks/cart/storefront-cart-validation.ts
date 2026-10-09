import { fetchWithCsrf } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import type { CartItem } from './cart-types';

interface CartValidationResponse {
  invalidProductIds?: string[];
  priceChanges?: {
    id: string;
    variantId?: string;
    offerId?: string;
    oldPrice: number;
    newPrice: number;
  }[];
}

// Mirrors the validate route's getCartValidationKey exactly: variant first,
// then the offer segment. Two offers that canonicalize to the same
// condition share product + condition, so the offer segment is what keeps
// their validation results on separate lines.
const createCartValidationKey = (
  id: string,
  variantId?: string | null,
  offerId?: string | null
) => {
  const variantKey = variantId ? `${id}::${variantId}` : id;
  return offerId ? `${variantKey}::offer=${offerId}` : variantKey;
};

const serializeVariantAttributes = (
  variantAttributes: CartItem['variantAttributes']
) => {
  if (!variantAttributes) return '';
  return Object.entries(variantAttributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join(',');
};

export const createCartHash = (cart: CartItem[]) => {
  return cart
    .map((item) => {
      const itemKey = createCartValidationKey(
        item.id,
        item.variantId,
        item.offerId
      );
      const serializedAttributes = serializeVariantAttributes(
        item.variantAttributes
      );
      return `${itemKey}:${item.condition ?? ''}:${serializedAttributes}:${item.price}`;
    })
    .sort()
    .join('|');
};

export const validateStorefrontCart = async (
  cart: CartItem[],
  signal: AbortSignal
) => {
  const limitedCart = cart.slice(0, 50).map((item) => ({
    condition: item.condition,
    id: item.id,
    price: item.price,
    variantAttributes: item.variantAttributes,
    variantId: item.variantId,
    offerId: item.offerId,
  }));

  const response = await fetchWithCsrf('/api/cart/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cartItems: limitedCart }),
    signal,
  });

  if (!response.ok) {
    logger.warn({
      message: 'Cart validation failed',
      status: response.status,
    });
    return null;
  }

  return (await response.json()) as CartValidationResponse;
};

export const applyValidationResults = (
  cart: CartItem[],
  validation: CartValidationResponse
) => {
  const invalidIds = new Set(validation.invalidProductIds || []);
  const priceChanges = new Map(
    (validation.priceChanges || []).map((priceChange) => [
      createCartValidationKey(
        priceChange.id,
        priceChange.variantId,
        priceChange.offerId
      ),
      priceChange,
    ])
  );

  if (invalidIds.size === 0 && priceChanges.size === 0) {
    return cart;
  }

  return cart
    .filter((item) => {
      const itemKey = createCartValidationKey(
        item.id,
        item.variantId,
        item.offerId
      );
      return !invalidIds.has(item.id) && !invalidIds.has(itemKey);
    })
    .map((item) => {
      const priceChange = priceChanges.get(
        createCartValidationKey(item.id, item.variantId, item.offerId)
      );
      if (!priceChange) {
        return item;
      }

      logger.info({
        message: 'Updated stale price in cart',
        productId: item.id,
        oldPrice: priceChange.oldPrice,
        newPrice: priceChange.newPrice,
      });

      // The base price changed, so any prior negotiation was made against a
      // stale basis and would be rejected at checkout (negotiated_price_below_floor).
      // Clear it so the line reverts to the live catalog price — parity with the
      // mobile reprice behavior.
      return {
        ...item,
        price: priceChange.newPrice,
        negotiatedPrice: undefined,
        negotiationStatus: undefined,
      };
    });
};
