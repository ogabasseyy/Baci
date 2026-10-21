import { logger } from '@/lib/logger';
import { CART_STORAGE_KEY } from './cart-storage';
import type { CartItem, SharedCartDisplayItem } from './cart-types';

// --- Shared-cart link support ---
//
// The merchant-scoped display cache above doubles as the legacy import
// source: on link activation the hook imports it exactly once, guarded
// by the receipt below, and keeps writing confirmed display lines to
// the same key. Temp optimistic markers never persist (see the hook).

export const SHARED_IMPORT_SUFFIX = 'shared-import';

export const getSharedCartImportStorageKey = (slug?: string | null) =>
  slug
    ? `${CART_STORAGE_KEY}-${slug}-${SHARED_IMPORT_SUFFIX}`
    : `${CART_STORAGE_KEY}-${SHARED_IMPORT_SUFFIX}`;

export interface SharedCartImportReceipt {
  cartId: string;
  importedAt: string;
  lineCount: number;
  /** Device line IDs the import consumed, when known. */
  consumedCartItemIds?: string[];
  /** Source quantity per consumed device line ID, when known. */
  consumedQuantities?: Record<string, number>;
}

export function isSharedCartImportReceipt(
  value: unknown
): value is SharedCartImportReceipt {
  if (typeof value !== 'object' || value === null) return false;
  const receipt = value as Record<string, unknown>;
  return (
    typeof receipt.cartId === 'string' &&
    receipt.cartId.length > 0 &&
    typeof receipt.importedAt === 'string' &&
    typeof receipt.lineCount === 'number' &&
    (receipt.consumedCartItemIds === undefined ||
      (Array.isArray(receipt.consumedCartItemIds) &&
        receipt.consumedCartItemIds.every((id) => typeof id === 'string'))) &&
    (receipt.consumedQuantities === undefined ||
      (typeof receipt.consumedQuantities === 'object' &&
        receipt.consumedQuantities !== null &&
        Object.values(receipt.consumedQuantities).every(
          (quantity) => typeof quantity === 'number'
        )))
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
export let cartSessionGeneration = 0;

export const cartSessionGenerationListeners = new Set<() => void>();

let globalGeneration = 0;
const merchantGenerations = new Map<string, number>();
export const getCartSessionGeneration = (slug?: string | null): number =>
  slug
    ? (merchantGenerations.get(slug) ?? globalGeneration)
    : cartSessionGeneration;

export interface CartTransitionChange {
  merchantSlug?: string | null;
  operationId?: string;
}
type GenerationChange = {
  from: number;
  generation: number;
  transition?: CartTransitionChange;
};
let generationChange: GenerationChange | null = null;
const generationChangesByMerchant = new Map<string, GenerationChange>();
// Operation-bearing changes must survive until their subscriber's
// effect consumes them, so retain the last few per merchant indexed
// by the generation they produced instead of only the latest.
const generationChangesByGeneration = new Map<
  string,
  Map<number, GenerationChange>
>();
const MAX_RETAINED_GENERATION_CHANGES = 8;
function recordGenerationChange(key: string, change: GenerationChange) {
  generationChangesByMerchant.set(key, change);
  let byGeneration = generationChangesByGeneration.get(key);
  if (!byGeneration) {
    byGeneration = new Map<number, GenerationChange>();
    generationChangesByGeneration.set(key, byGeneration);
  }
  byGeneration.set(change.generation, change);
  while (byGeneration.size > MAX_RETAINED_GENERATION_CHANGES) {
    const oldest = byGeneration.keys().next().value;
    if (oldest === undefined) break;
    byGeneration.delete(oldest);
  }
}
const GLOBAL_CHANGE_KEY = '__global__';
export const getCartSessionGenerationChange = (
  merchantSlug?: string | null,
  generation?: number
) => {
  if (merchantSlug !== undefined) {
    if (generation !== undefined) {
      const indexed = generationChangesByGeneration
        .get(merchantSlug ?? GLOBAL_CHANGE_KEY)
        ?.get(generation);
      if (indexed) return indexed;
    }
    return (
      generationChangesByMerchant.get(merchantSlug ?? GLOBAL_CHANGE_KEY) ??
      generationChange
    );
  }
  return generationChange;
};

export const bumpCartSessionGeneration = (
  transition?: CartTransitionChange
): number => {
  const from = getCartSessionGeneration(transition?.merchantSlug);
  const knownMerchants = [...merchantGenerations.keys()];
  cartSessionGeneration += 1;
  if (transition?.merchantSlug)
    merchantGenerations.set(transition.merchantSlug, cartSessionGeneration);
  else {
    globalGeneration = cartSessionGeneration;
    merchantGenerations.clear();
  }
  generationChange = { from, generation: cartSessionGeneration, transition };
  recordGenerationChange(
    transition?.merchantSlug ?? GLOBAL_CHANGE_KEY,
    generationChange
  );
  // A global bump fences every merchant, so record it for each known
  // merchant as well as the global slot.
  if (!transition?.merchantSlug) {
    for (const slug of knownMerchants)
      recordGenerationChange(slug, generationChange);
  }
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
 * Voucher credentials never persist either: the token/award pair is a
 * replayable credential, and the authorized snapshot rehydrates it
 * in memory on reload, so the at-rest display shell keeps no secret.
 * (The one-time legacy import reads the cache before the first
 * confirmed save, while legacy-written lines still carry theirs.)
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
        quizVoucherToken: _quizVoucherToken,
        quizAwardId: _quizAwardId,
        ...rest
      } = line;
      return rest as CartItem;
    });
