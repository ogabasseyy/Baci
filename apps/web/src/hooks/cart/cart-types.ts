import type { CartErrorCode } from '@baci/shared/cart';
import type { Product } from '@/lib/products';

/**
 * Link markers for a shared-cart display line. `serverLineId` is the
 * stable id once the server confirms the line; `pendingTempId` marks
 * an optimistic line whose command has not reconciled yet. Temp lines
 * never persist: storage strips the marker on save and drops it on load.
 */
export interface SharedCartLineMarkers {
  serverLineId?: string | null;
  pendingTempId?: string | null;
  /** True when the line is confirmed but its catalog details failed to load. */
  hydrationFailed?: boolean;
}

export type SharedCartDisplayItem = CartItem & SharedCartLineMarkers;

export type SharedCartSyncStatus = 'synced' | 'pending' | 'retrying' | 'error';

export type SharedCartImportStatus =
  | 'none'
  | 'pending'
  | 'done'
  | 'skipped'
  | 'failed';

export interface CartItem extends Product {
  quantity: number;
  variantId?: string;
  variantAttributes?: Record<string, string>;
  cartItemId: string;
  selectedColor?: string;
  selectedColorValue?: string;
  secondaryColor?: string;
  secondaryColorValue?: string;
  selectedStorage?: string;
  condition?: 'new' | 'used' | 'open_box' | 'refurbished';
  offerId?: string;
  negotiatedPrice?: number;
  negotiationStatus?: 'none' | 'pending' | 'accepted' | 'rejected';
  cartDiscount?: number;
  quizAwardId?: string;
  quizVoucherToken?: string;
  hasAssurance?: boolean;
  assuranceRate?: number;
}

export interface AddToCartOptions {
  variantId?: string;
  variantAttributes?: Record<string, string>;
  color?: string;
  colorValue?: string;
  secondaryColor?: string;
  secondaryColorValue?: string;
  storage?: string;
  condition?: string;
  /**
   * Exact condition-offer id that priced this add. Two offers can
   * canonicalize to the same condition (used vs uk_used), so the condition
   * alone cannot identify the line; `generateCartItemId` folds this into
   * the line id via its extra-attribute loop.
   */
  offerId?: string;
  quizAwardId?: string;
  quizVoucherToken?: string;
  platform?: string;
  hasAssurance?: boolean;
  [key: string]: string | boolean | Record<string, string> | undefined;
}

/**
 * Whether an addToCart call changed the cart. Stock-cap rejections and
 * guard rejections (out-of-stock, missing variant) leave the cart
 * untouched; callers gate success effects (toasts, upsells, analytics)
 * on this instead of assuming the add landed.
 */
export type AddToCartOutcome = 'applied' | 'rejected';

export interface CartContextType {
  cart: CartItem[];
  merchantSlug: string | null;
  addToCart: (
    product: Product,
    quantity?: number,
    options?: AddToCartOptions
  ) => AddToCartOutcome;
  removeFromCart: (cartItemIdOrProductId: string, variantId?: string) => void;
  updateQuantity: (
    cartItemIdOrProductId: string,
    quantity: number,
    variantId?: string
  ) => void;
  clearCart: () => void;
  setMerchantSlug: (slug: string) => void;
  cartCount: number;
  cartTotal: number;
  totalItems: number;
  subtotal: number;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  applyNegotiatedPrice?: (cartItemId: string, newPrice: number) => void;
  applyCartWideNegotiation?: (newTotal: number) => void;
  clearNegotiatedPrice?: (cartItemId: string) => void;
  /** True while a cart-wide (group) negotiation is applied. */
  cartWideNegotiationActive?: boolean;
  toggleAssurance?: (cartItemId: string) => void;
  lastAddedProduct: Product | null;
  showUpsell: boolean;
  dismissUpsell: () => void;
  hasSmartCartPro: boolean;
  isHydrated: boolean;
  /** Present only when the provider delegates to the shared server cart. */
  sharedCartEnabled?: boolean;
  /** Account linking additionally requires the accounts enrollment. */
  sharedCartAccountsEnabled?: boolean;
  /**
   * Authoritative cart identity for checkout binding. Null until the
   * shared snapshot is adopted; absent in legacy mode.
   */
  sharedCartRef?: { cartId: string; version: number } | null;
  /** Refetches the authoritative snapshot; absent in legacy mode. */
  refreshSharedCart?: () => Promise<void>;
  /** Last-confirmed-plus-pending sync state; absent in legacy mode. */
  syncStatus?: SharedCartSyncStatus;
  /** Last sync failure code, cleared on the next success. */
  syncError?: CartErrorCode | null;
  /** Re-sends the head of the pending queue with its original retry key. */
  retryPendingSync?: () => void;
  /** Explicitly discards the saved device import and keeps the canonical cart. */
  discardLegacyImport?: () => void;
  /** Import warnings such as `import_capacity_exceeded`. */
  importWarnings?: string[];
  /** Initial device-cart import lifecycle state, when delegated. */
  importStatus?: SharedCartImportStatus;
  /** Legacy-import lines blocked on an explicit offer choice. */
  importConflicts?: import('@baci/shared/cart').CartMergeConflict[];
  /** Applies the shopper's per-line choices and retries the import. */
  resolveImportConflicts?: (
    resolutions: import('@baci/shared/cart').CartMergeResolution[]
  ) => void;
}
