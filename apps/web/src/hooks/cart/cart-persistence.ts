import { logger } from '@/lib/logger';
import type { AddToCartOptions, CartItem } from './cart-types';

const CART_STORAGE_KEY = 'baci-cart';
const GUEST_CART_SUFFIX = 'guest';
export const DEFAULT_DEFERRED_VALIDATION_TIMEOUT_MS = 2500;
/**
 * Get cart storage key namespaced by merchant and optionally by user ID
 * 2026 Best Practice: Separate guest carts from authenticated user carts
 * to prevent cart data leakage between users on shared devices
 */
const getCartStorageKey = (slug?: string | null, userId?: string | null) => {
  const userSuffix = userId || GUEST_CART_SUFFIX;
  return slug
    ? `${CART_STORAGE_KEY}-${slug}-${userSuffix}`
    : `${CART_STORAGE_KEY}-${userSuffix}`;
};
const MERCHANT_SLUG_KEY = 'baci-cart-merchant-slug';

/**
 * Clear cart from localStorage. Can be called outside React context.
 * Used for logout to prevent cart data leakage between users.
 * 2026 Best Practice: Clears both user-specific and guest carts
 */
export const clearCartStorage = (
  merchantSlug?: string | null,
  userId?: string | null
): void => {
  if (typeof window === 'undefined') return;
  try {
    // Clear cart for specific merchant + user combination
    if (merchantSlug) {
      window.localStorage.removeItem(getCartStorageKey(merchantSlug, userId));
      // Also clear guest cart for this merchant (prevents stale guest data)
      window.localStorage.removeItem(
        getCartStorageKey(merchantSlug, GUEST_CART_SUFFIX)
      );
    }
    // Also clear the default cart keys (for legacy/fallback)
    window.localStorage.removeItem(CART_STORAGE_KEY);
    window.localStorage.removeItem(`${CART_STORAGE_KEY}-${GUEST_CART_SUFFIX}`);
  } catch (error) {
    console.error('Failed to clear cart from localStorage', error);
  }
};

export const generateCartItemId = (
  productId: string,
  options?: AddToCartOptions
): string => {
  const parts = [productId];
  if (options?.variantId) parts.push(`variant=${options.variantId}`);
  if (options?.color) parts.push(`color=${options.color}`);
  if (options?.secondaryColor)
    parts.push(`secondaryColor=${options.secondaryColor}`);
  if (options?.condition) parts.push(`condition=${options.condition}`);

  // Include all extra attribute keys (sorted) for deterministic IDs.
  // This mirrors buildCartItemId's selectedAttributes handling.
  if (options) {
    const skipKeys = new Set([
      'variantId',
      'variantAttributes',
      'color',
      'colorValue',
      'secondaryColor',
      'secondaryColorValue',
      'condition',
    ]);
    for (const key of Object.keys(options).sort()) {
      if (skipKeys.has(key)) continue;
      const value = options[key];
      if (typeof value === 'string' && value) {
        parts.push(`${key}=${value}`);
      }
    }
  }

  return parts.join('::');
};

function getStoredStringValue(
  item: Record<string, unknown>,
  key: string
): string | undefined {
  const value = item[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getStoredNumberValue(
  item: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const value = item[key];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : fallback;
  }

  return fallback;
}

function getStoredVariantAttributes(
  item: Record<string, unknown>
): Record<string, string> | undefined {
  const value = item.variantAttributes;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].length > 0
    )
  );
}

function normalizeStoredCartItem(item: Record<string, unknown>): CartItem {
  const productId = getStoredStringValue(item, 'id') ?? '';
  const variantId =
    getStoredStringValue(item, 'variantId') ??
    getStoredStringValue(item, 'variant_id');
  const variantAttributes = getStoredVariantAttributes(item);
  const selectedColor =
    getStoredStringValue(item, 'selectedColor') ??
    getStoredStringValue(item, 'variantColor') ??
    variantAttributes?.color;
  const selectedStorage =
    getStoredStringValue(item, 'selectedStorage') ??
    getStoredStringValue(item, 'variantStorage') ??
    variantAttributes?.storage;
  const selectedColorValue =
    getStoredStringValue(item, 'selectedColorValue') ??
    variantAttributes?.colorValue;
  const secondaryColor =
    getStoredStringValue(item, 'secondaryColor') ??
    variantAttributes?.secondaryColor;
  const secondaryColorValue =
    getStoredStringValue(item, 'secondaryColorValue') ??
    variantAttributes?.secondaryColorValue;
  const condition = getStoredStringValue(item, 'condition') as
    | CartItem['condition']
    | undefined;
  const cartItemId =
    getStoredStringValue(item, 'cartItemId') ??
    generateCartItemId(productId, {
      color: selectedColor,
      colorValue: selectedColorValue,
      condition,
      secondaryColor,
      secondaryColorValue,
      storage: selectedStorage,
      variantId,
    });

  return {
    ...item,
    cartItemId,
    price: getStoredNumberValue(item, 'price', 0),
    quantity: getStoredNumberValue(item, 'quantity', 1),
    selectedColor,
    selectedColorValue,
    secondaryColor,
    secondaryColorValue,
    selectedStorage,
    condition,
    variantAttributes,
    variantId,
  } as CartItem;
}

export const getCartFromStorage = (
  slug?: string | null,
  userId?: string | null
): CartItem[] => {
  if (typeof window === 'undefined') return [];
  try {
    const item = window.localStorage.getItem(getCartStorageKey(slug, userId));
    const parsed = item ? JSON.parse(item) : [];

    // Validate items structure to prevent NaN prices and ghost items
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((i: unknown): i is Record<string, unknown> => {
        if (typeof i !== 'object' || i === null) return false;
        const item = i as Record<string, unknown>;
        return typeof item.id === 'string' && typeof item.name === 'string';
      })
      .map(normalizeStoredCartItem);
  } catch (error) {
    logger.error({
      message: 'Failed to read cart from localStorage',
      error: error as Error,
    });
    return [];
  }
};

export const saveCartToStorage = (
  cart: CartItem[],
  slug?: string | null,
  userId?: string | null
) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      getCartStorageKey(slug, userId),
      JSON.stringify(cart)
    );
  } catch (error) {
    logger.error({
      message: 'Failed to save cart to localStorage',
      error: error as Error,
    });
  }
};

export const getMerchantSlugFromStorage = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(MERCHANT_SLUG_KEY);
  } catch {
    return null;
  }
};

export const saveMerchantSlugToStorage = (slug: string | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (slug) {
      window.localStorage.setItem(MERCHANT_SLUG_KEY, slug);
    } else {
      window.localStorage.removeItem(MERCHANT_SLUG_KEY);
    }
  } catch (error) {
    logger.error({
      message: 'Failed to save merchant slug',
      error: error as Error,
    });
  }
};
