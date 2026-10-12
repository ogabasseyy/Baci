import { logger } from '@/lib/logger';
import type {
  AddToCartOptions,
  CartItem,
  SharedCartDisplayItem,
} from './cart-types';

const CART_STORAGE_KEY = 'baci-cart';
const GUEST_CART_SUFFIX = 'guest';

export { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
export const DEFAULT_DEFERRED_VALIDATION_TIMEOUT_MS = 2500;
const MERCHANT_SLUG_KEY = 'baci-cart-merchant-slug';

export const getStorefrontCartStorageKey = (slug?: string | null) => {
  return slug
    ? `${CART_STORAGE_KEY}-${slug}-${GUEST_CART_SUFFIX}`
    : `${CART_STORAGE_KEY}-${GUEST_CART_SUFFIX}`;
};

export const generateCartItemId = (
  productId: string,
  options?: AddToCartOptions
): string => {
  const parts = [productId];
  if (options?.variantId) parts.push(`variant=${options.variantId}`);
  if (options?.color) parts.push(`color=${options.color}`);
  if (options?.secondaryColor) {
    parts.push(`secondaryColor=${options.secondaryColor}`);
  }
  if (options?.condition) parts.push(`condition=${options.condition}`);

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

export const getCartFromStorage = (
  slug?: string | null
): SharedCartDisplayItem[] => {
  if (typeof window === 'undefined') return [];

  try {
    const item = window.localStorage.getItem(getStorefrontCartStorageKey(slug));
    const parsed = item ? JSON.parse(item) : [];

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry: unknown): entry is Record<string, unknown> => {
        if (typeof entry !== 'object' || entry === null) return false;
        const item = entry as Record<string, unknown>;
        return typeof item.id === 'string' && typeof item.name === 'string';
      })
      .map((entry) => {
        // Temp optimistic markers never survive storage: an unconfirmed
        // line must not resurrect after reload. The stable server id is
        // kept so a re-adopted cache still matches its confirmed lines.
        const {
          pendingTempId: _pendingTempId,
          hydrationFailed: _hydrationFailed,
          ...rest
        } = entry;
        return {
          ...rest,
          price:
            typeof entry.price === 'number' && !Number.isNaN(entry.price)
              ? entry.price
              : Number(entry.price) || 0,
          quantity:
            typeof entry.quantity === 'number' && !Number.isNaN(entry.quantity)
              ? entry.quantity
              : Number(entry.quantity) || 1,
          serverLineId:
            typeof entry.serverLineId === 'string'
              ? entry.serverLineId
              : undefined,
        } as SharedCartDisplayItem;
      });
  } catch (error) {
    logger.error({
      message: 'Failed to read cart from localStorage',
      error: error as Error,
    });
    return [];
  }
};

export const saveCartToStorage = (cart: CartItem[], slug?: string | null) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      getStorefrontCartStorageKey(slug),
      JSON.stringify(cart)
    );
  } catch (error) {
    logger.error({
      message: 'Failed to save cart to localStorage',
      error: error as Error,
    });
  }
};

const GROUP_NEGOTIATION_SUFFIX = 'group-negotiation';

export const getStorefrontGroupNegotiationStorageKey = (
  slug?: string | null
) =>
  slug
    ? `${CART_STORAGE_KEY}-${slug}-${GROUP_NEGOTIATION_SUFFIX}`
    : `${CART_STORAGE_KEY}-${GROUP_NEGOTIATION_SUFFIX}`;

// A cart-wide (group) negotiation is distributed across the persisted lines but
// the "this is a group deal" flag lives only in React state. Persist it so a
// reload can tell a group deal apart from individual line deals — otherwise the
// rehydrated cart keeps every negotiatedPrice while the flag resets to false,
// and remove/update/validation paths leave stale group shares behind.
export const getCartWideNegotiationFromStorage = (
  slug?: string | null
): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    return (
      window.localStorage.getItem(
        getStorefrontGroupNegotiationStorageKey(slug)
      ) === 'true'
    );
  } catch {
    return false;
  }
};

export const saveCartWideNegotiationToStorage = (
  active: boolean,
  slug?: string | null
) => {
  if (typeof window === 'undefined') return;

  try {
    const key = getStorefrontGroupNegotiationStorageKey(slug);
    if (active) {
      window.localStorage.setItem(key, 'true');
    } else {
      window.localStorage.removeItem(key);
    }
  } catch (error) {
    logger.error({
      message: 'Failed to save cart-wide negotiation flag',
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
      return;
    }

    window.localStorage.removeItem(MERCHANT_SLUG_KEY);
  } catch (error) {
    logger.error({
      message: 'Failed to save merchant slug',
      error: error as Error,
    });
  }
};

// --- Shared-cart link support ---
//
// The merchant-scoped display cache above doubles as the legacy import
// source: on link activation the hook imports it exactly once, guarded
// by the receipt below, and keeps writing confirmed display lines to
// the same key. Temp optimistic markers never persist (see the hook).

const SHARED_IMPORT_SUFFIX = 'shared-import';

export const getSharedCartImportStorageKey = (slug?: string | null) =>
  slug
    ? `${CART_STORAGE_KEY}-${slug}-${SHARED_IMPORT_SUFFIX}`
    : `${CART_STORAGE_KEY}-${SHARED_IMPORT_SUFFIX}`;

export interface SharedCartImportReceipt {
  cartId: string;
  importedAt: string;
  lineCount: number;
}

function isSharedCartImportReceipt(
  value: unknown
): value is SharedCartImportReceipt {
  if (typeof value !== 'object' || value === null) return false;
  const receipt = value as Record<string, unknown>;
  return (
    typeof receipt.cartId === 'string' &&
    receipt.cartId.length > 0 &&
    typeof receipt.importedAt === 'string' &&
    typeof receipt.lineCount === 'number'
  );
}

export const getSharedCartImportReceipt = (
  slug?: string | null
): SharedCartImportReceipt | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(
      getSharedCartImportStorageKey(slug)
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSharedCartImportReceipt(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const saveSharedCartImportReceipt = (
  slug: string | null | undefined,
  receipt: SharedCartImportReceipt
): void => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      getSharedCartImportStorageKey(slug),
      JSON.stringify(receipt)
    );
  } catch (error) {
    logger.error({
      message: 'Failed to save shared-cart import receipt',
      error: error as Error,
    });
  }
};

export const clearSharedCartImportReceipt = (slug?: string | null): void => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(getSharedCartImportStorageKey(slug));
  } catch (error) {
    logger.error({
      message: 'Failed to clear shared-cart import receipt',
      error: error as Error,
    });
  }
};

// In-memory session generation: merchant switches, cart clears and
// customer logouts bump it so late server responses from the previous
// session are fenced instead of corrupting the new cart. Deliberately
// not persisted — a reload starts a fresh session that re-adopts.
let cartSessionGeneration = 0;
const cartSessionGenerationListeners = new Set<() => void>();

export const getCartSessionGeneration = (): number => cartSessionGeneration;

export const bumpCartSessionGeneration = (): number => {
  cartSessionGeneration += 1;
  for (const listener of [...cartSessionGenerationListeners]) {
    listener();
  }
  return cartSessionGeneration;
};

export const subscribeCartSessionGeneration = (
  listener: () => void
): (() => void) => {
  cartSessionGenerationListeners.add(listener);
  return () => {
    cartSessionGenerationListeners.delete(listener);
  };
};

/**
 * Persistable view of the linked display: temp optimistic lines never
 * persist, and link markers stay out of storage (the stable server id
 * is the one marker kept, so a reload still matches confirmed lines).
 */
export const stripUnconfirmedDisplayLines = (
  display: SharedCartDisplayItem[]
): CartItem[] =>
  display
    .filter((line) => line.pendingTempId == null)
    .map((line) => {
      const {
        pendingTempId: _pendingTempId,
        hydrationFailed: _hydrationFailed,
        ...rest
      } = line;
      return rest as CartItem;
    });
