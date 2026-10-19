'use client';

import {
  type CartCommand,
  type CartErrorCode,
  type CartSnapshot,
  cartLineIdentity,
} from '@baci/shared/cart';

import type { CartMergeConflict } from '@/lib/cart/merge';

import type { Product } from '@/lib/products';

import type {
  AddToCartOptions,
  CartItem,
  SharedCartDisplayItem,
  SharedCartImportStatus,
  SharedCartSyncStatus,
} from './cart-types';

import {
  cartItemToIdentity,
  type SharedCartIntent,
  type SharedCartLineTarget,
  type SharedCartState,
} from './shared-cart-reducer';

export interface UseSharedCartOptions {
  merchantId: string;
  merchantSlug: string | null;
  sessionGeneration: number;
  enabled?: boolean;
  /** Task 8 wires the live subscription; until then the fallback poll owns convergence. */
  realtimeConnected?: boolean;
  realtimeEnabled?: boolean;
  /** The owning surface gates background polling when it goes inactive. */
  surfaceActive?: boolean;
}

export interface UseSharedCartResult {
  cart: SharedCartDisplayItem[];
  cartId: string | null;
  version: number | null;
  cartCount: number;
  cartTotal: number;
  isHydrated: boolean;
  syncStatus: SharedCartSyncStatus;
  syncError: CartErrorCode | null;
  importStatus: SharedCartImportStatus;
  importConflicts: CartMergeConflict[];
  importWarnings: string[];
  addToCart: (
    product: Product,
    quantity?: number,
    options?: AddToCartOptions
  ) => void;
  removeFromCart: (cartItemIdOrProductId: string, variantId?: string) => void;
  updateQuantity: (
    cartItemIdOrProductId: string,
    quantity: number,
    variantId?: string
  ) => void;
  clearCart: () => void;
  repriceLine: (line: SharedCartDisplayItem, price?: number) => void;
  toggleAssurance: (cartItemId: string) => void;
  retryPendingSync: () => void;
  retryImport: () => void;
  discardLegacyImport: () => void;
  resolveImportConflicts: (
    resolutions: import('@baci/shared/cart').CartMergeResolution[]
  ) => void;
  /** Refetches the authoritative snapshot (checkout review refresh). */
  refreshSharedCart: () => Promise<void>;
}

export type AdoptOutcome =
  | 'unknown'
  | 'session'
  | 'bootstrap'
  | 'none'
  | 'expired';

/**
 * Failure detail for cart provisioning. `null` means the session
 * generation moved on mid-flight and the caller must stay silent; every
 * other failure carries its real code so the head entry surfaces it
 * instead of stalling silently in the queue.
 */
export type EnsureCartResult =
  | { ok: true }
  | { ok: false; code: CartErrorCode; retryable: boolean }
  | null;

export const FALLBACK_POLL_MS = 15_000;

export const RECONCILE_POLL_MS = 60_000;

export const FETCH_COALESCE_MS = 5_000;

export const RETRY_BASE_MS = 1_000;

export const RETRY_MAX_MS = 30_000;

export const MAX_AUTO_RETRIES = 5;

export const ADOPT_RETRY_BASE_MS = 1_000;

/** Shared inert action for the disabled hook shape. */
export function noop(): void {
  // Intentionally empty: the disabled hook never acts.
}

export function jittered(baseMs: number): number {
  return baseMs * (0.8 + Math.random() * 0.4);
}

export function backoffMs(baseMs: number, attempts: number): number {
  return Math.min(RETRY_MAX_MS, baseMs * 2 ** attempts);
}

export function findMatchingLineIndex(
  display: SharedCartDisplayItem[],
  cartItemIdOrProductId: string,
  variantId?: string
): number {
  const exact = display.findIndex(
    (line) => line.cartItemId === cartItemIdOrProductId
  );
  if (exact >= 0) return exact;
  return display.findIndex((line) => {
    if (line.id !== cartItemIdOrProductId) return false;
    if (variantId !== undefined) return line.variantId === variantId;
    return line.variantId === undefined;
  });
}

export function targetForLine(
  line: SharedCartDisplayItem
): SharedCartLineTarget {
  // A stable server id always wins: temp targets resolve only when an add
  // reconciles, so preferring a stale temp claim would strand edits behind
  // an unresolvable block. Pure optimistic lines have no server id yet.
  if (line.serverLineId) return { kind: 'lineId', lineId: line.serverLineId };
  if (line.pendingTempId) return { kind: 'temp', tempId: line.pendingTempId };
  return { kind: 'identity', key: cartLineIdentity(cartItemToIdentity(line)) };
}

export function seedProducts(cached: CartItem[]): Record<string, Product> {
  const products: Record<string, Product> = {};
  for (const item of cached) {
    products[cartLineIdentity(cartItemToIdentity(item))] = item as Product;
  }
  return products;
}

export function optionsFromLine(line: SharedCartDisplayItem): AddToCartOptions {
  return {
    color: line.selectedColor,
    colorValue: line.selectedColorValue,
    condition: line.condition,
    quizAwardId: line.quizAwardId ?? undefined,
    quizVoucherToken: line.quizVoucherToken ?? undefined,
    secondaryColor: line.secondaryColor,
    secondaryColorValue: line.secondaryColorValue,
    storage: line.selectedStorage,
    variantAttributes: line.variantAttributes,
    variantId: line.variantId,
  };
}

export function resolveCommandTarget(
  target: SharedCartLineTarget,
  confirmed: CartSnapshot | null
): string | null {
  if (!confirmed) return null;
  if (target.kind === 'lineId') {
    return confirmed.lines.some((line) => line.id === target.lineId)
      ? target.lineId
      : null;
  }
  if (target.kind === 'identity') {
    return (
      confirmed.lines.find((line) => cartLineIdentity(line.item) === target.key)
        ?.id ?? null
    );
  }
  return null;
}

export function buildCommand(
  intent: SharedCartIntent,
  state: SharedCartState
): CartCommand | null {
  if (intent.kind === 'replace')
    return { type: 'replace', lines: intent.lines };
  if (intent.kind === 'clear') return { type: 'clear' };
  if (intent.kind === 'add') {
    if (intent.input) {
      return {
        ...(intent.input.negotiatedUnitPriceMinor != null
          ? {
              negotiatedUnitPriceMinor: intent.input.negotiatedUnitPriceMinor,
            }
          : {}),
        ...(intent.input.negotiationStatus
          ? { negotiationStatus: intent.input.negotiationStatus }
          : {}),
        ...(intent.input.voucherToken
          ? { voucherToken: intent.input.voucherToken }
          : {}),
        ...(intent.input.voucherAwardId
          ? { voucherAwardId: intent.input.voucherAwardId }
          : {}),
        item: intent.input.item,
        quantity: intent.quantity,
        type: 'add',
      };
    }
    const item = cartItemToIdentity({
      condition: intent.options?.condition,
      id: intent.product.id,
      selectedColor: intent.options?.color,
      selectedColorValue: intent.options?.colorValue,
      selectedStorage: intent.options?.storage,
      secondaryColor: intent.options?.secondaryColor,
      secondaryColorValue: intent.options?.secondaryColorValue,
      variantAttributes: intent.options?.variantAttributes,
      variantId: intent.options?.variantId,
    });
    return {
      ...(intent.attachments?.negotiatedUnitPriceMinor != null
        ? {
            negotiatedUnitPriceMinor:
              intent.attachments.negotiatedUnitPriceMinor,
          }
        : {}),
      ...(intent.attachments?.negotiationStatus
        ? { negotiationStatus: intent.attachments.negotiationStatus }
        : {}),
      ...((intent.attachments?.voucherToken ?? intent.options?.quizVoucherToken)
        ? {
            voucherToken: (intent.attachments?.voucherToken ??
              intent.options?.quizVoucherToken) as string,
          }
        : {}),
      ...((intent.attachments?.voucherAwardId ?? intent.options?.quizAwardId)
        ? {
            voucherAwardId: (intent.attachments?.voucherAwardId ??
              intent.options?.quizAwardId) as string,
          }
        : {}),
      item,
      quantity: intent.quantity,
      type: 'add',
    };
  }
  const lineId = resolveCommandTarget(intent.target, state.confirmed);
  if (!lineId) return null;
  if (intent.kind === 'remove') return { lineId, type: 'remove' };
  if (intent.kind === 'set_assurance')
    return { hasAssurance: intent.hasAssurance, lineId, type: 'set_assurance' };
  if (intent.kind === 'set_negotiated_price')
    return {
      lineId,
      negotiatedUnitPriceMinor: intent.negotiatedUnitPriceMinor,
      type: 'set_negotiated_price',
    };
  return { lineId, quantity: intent.quantity, type: 'set_quantity' };
}
