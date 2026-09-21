import {
  isSantaGrantedPriceWithinCeiling,
  parseSantaActions,
  type SantaAction,
} from '@baci/shared/lib';
import { showCartToast } from '@/hooks/cart-notifications';
import { CONFIG } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import type { SantaProductLookupResult } from '@/schemas/santa-product-lookup';
import { santaProductLookupResponseSchema } from '@/schemas/santa-product-lookup';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';
import {
  API_BASE_URL,
  SANTA_MERCHANT_SLUG_HEADER,
  STOREFRONT_MERCHANT_SLUG_HEADER,
} from './constants';

const log = createLogger('santa-cart');

async function lookupSantaProduct(
  productName: string,
  expectedMerchantSlug: string,
  signal?: AbortSignal
): Promise<SantaProductLookupResult | null> {
  const response = await fetch(`${API_BASE_URL}/api/chat/santa/product`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [STOREFRONT_MERCHANT_SLUG_HEADER]: expectedMerchantSlug,
    },
    body: JSON.stringify({ name: productName }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Santa product lookup failed (${response.status})`);
  }

  const resolvedMerchantSlug = response.headers
    .get(SANTA_MERCHANT_SLUG_HEADER)
    ?.trim();
  if (resolvedMerchantSlug !== expectedMerchantSlug) {
    log.warn('Ignoring Santa product from a different storefront', {
      expectedMerchantSlug,
      resolvedMerchantSlug,
    });
    return null;
  }

  const parsed = santaProductLookupResponseSchema.safeParse(
    await response.json()
  );

  if (!parsed.success) {
    throw new Error('Santa product lookup returned an invalid payload');
  }

  return parsed.data.product;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function slugifySantaProductName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildSantaCartItem(
  product: SantaProductLookupResult,
  grantedPrice: number
): Omit<CartItem, 'id'> {
  // Santa already negotiated the price the customer should pay. Only treat it as
  // a negotiated price when it actually beats the catalog price (mirrors web).
  // The model price is untrusted: honor it only inside the server-computed
  // per-product ceiling, otherwise keep catalog price.
  const hasDiscount =
    grantedPrice >= 0 &&
    grantedPrice < product.price &&
    isSantaGrantedPriceWithinCeiling(
      product.price,
      grantedPrice,
      product.max_discount_percentage ?? 0
    );
  const managesStock = product.manage_stock === true;
  const slug =
    product.slug?.trim() || product.id || slugifySantaProductName(product.name);

  return {
    product_id: product.id,
    slug,
    name: product.name,
    price: product.price,
    quantity: 1,
    image_url: product.image || undefined,
    max_quantity: managesStock ? (product.stock ?? undefined) : undefined,
    negotiatedPrice: hasDiscount ? grantedPrice : undefined,
    negotiationStatus: hasDiscount ? 'accepted' : undefined,
  };
}

/**
 * Fulfil the Santa `ADD_TO_CART` wishes in a chat reply, but only when the
 * response was resolved for this storefront. Each wish is fire-and-forget so
 * the reply renders immediately; addSantaWishToCart surfaces its own
 * success/error toast. Replies resolved for another storefront are ignored.
 */
export function fulfilSantaCartActions(args: {
  expectedMerchantSlug: string;
  resolvedMerchantSlug: string | undefined;
  signal?: AbortSignal;
  text: string;
}): void {
  const actions = parseSantaActions(args.text);
  if (args.resolvedMerchantSlug !== args.expectedMerchantSlug) {
    if (actions.length > 0) {
      log.warn('Ignoring Santa cart actions for a different storefront', {
        expectedMerchantSlug: args.expectedMerchantSlug,
        resolvedMerchantSlug: args.resolvedMerchantSlug,
      });
    }
    return;
  }

  for (const action of actions) {
    void addSantaWishToCart(action, args.signal, args.expectedMerchantSlug);
  }
}

/**
 * Fulfil a Santa `ADD_TO_CART` wish: resolve the product (real or synthetic)
 * and add it to the cart at Santa's granted price. Best-effort — surfaces a
 * toast on success/failure and never throws (chat flow must continue).
 */
export async function addSantaWishToCart(
  action: SantaAction,
  signal?: AbortSignal,
  expectedMerchantSlug = CONFIG.MERCHANT_SLUG.trim()
): Promise<boolean> {
  try {
    const product = await lookupSantaProduct(
      action.productName,
      expectedMerchantSlug,
      signal
    );
    if (!product) {
      showCartToast(
        `Santa couldn't find "${action.productName}" in the store`,
        'error'
      );
      return false;
    }

    useCartStore.getState().addItem(buildSantaCartItem(product, action.price));
    showCartToast(`🎁 ${product.name} added to your cart`, 'success');
    return true;
  } catch (error) {
    if (isAbortError(error)) {
      return false;
    }

    log.error('Failed to add Santa wish to cart:', error);
    showCartToast('Could not add Santa’s gift to your cart', 'error');
    return false;
  }
}
