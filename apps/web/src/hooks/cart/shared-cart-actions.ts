'use client';

import {
  cartLineIdentity,
  SHARED_CART_MAX_QUANTITY_PER_LINE,
} from '@baci/shared/cart';

import type { Product } from '@/lib/products';

import type { AddToCartOptions, SharedCartDisplayItem } from './cart-types';
import {
  findMatchingLineIndex,
  targetForLine,
} from './shared-cart-hook-support';
import { isTerminalCart } from './shared-cart-queue';
import {
  cartItemToIdentity,
  displayLineMatchesAddLane,
  type SharedCartIntent,
} from './shared-cart-reducer';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

export function createCartActions(context: SharedCartRuntime) {
  const { enabled, dispatch, stateRef, generationRef, tempCounterRef } =
    context;

  function enqueueIntent(intent: SharedCartIntent): void {
    if (!enabled) return;
    const generation = generationRef.current;
    dispatch({
      entry: { intent, operationId: crypto.randomUUID() },
      generation,
      type: 'command/enqueue',
    });
  }

  function addToCart(
    product: Product,
    quantity = 1,
    options?: AddToCartOptions
  ): void {
    if (!enabled) return;
    // Mirror gateAddToCart exactly: an award id alone (no token yet)
    // exempts the reserved unit from the stock guard and pins quantity.
    const productRecord = product as unknown as Record<string, unknown>;
    const isVoucherProduct = Boolean(
      options?.quizVoucherToken ||
        options?.quizAwardId ||
        productRecord.quizVoucherToken ||
        productRecord.isQuizPrize
    );
    if (product.manage_stock && product.stock <= 0 && !isVoucherProduct) {
      return;
    }
    if (options?.variantRequired && !options?.variantId) return;
    const current = stateRef.current;
    const key = cartLineIdentity(
      cartItemToIdentity({
        condition: options?.condition,
        id: product.id,
        offerId: options?.offerId,
        selectedColor: options?.color,
        selectedColorValue: options?.colorValue,
        selectedStorage: options?.storage,
        secondaryColor: options?.secondaryColor,
        secondaryColorValue: options?.secondaryColorValue,
        variantAttributes: options?.variantAttributes,
        variantId: options?.variantId,
      })
    );
    // The server merges an add only into the line whose voucher
    // attachments also match (commerce_cart_mutate line identity), so
    // the per-line cap applies per attachment-distinct line: an
    // ordinary line at the cap must not block a voucher add, and a
    // voucher line must not eat into an ordinary add's headroom.
    const voucherToken =
      options?.quizVoucherToken ??
      (typeof productRecord.quizVoucherToken === 'string'
        ? productRecord.quizVoucherToken
        : undefined);
    const voucherAwardId =
      options?.quizAwardId ??
      (typeof productRecord.quizAwardId === 'string'
        ? productRecord.quizAwardId
        : undefined);
    const existing = current.display
      .filter(
        (line) =>
          cartLineIdentity(cartItemToIdentity(line)) === key &&
          // A fresh add carries no negotiation attachments, so only
          // the ordinary lane counts toward its per-line cap; a
          // negotiated sibling is a separate server line.
          displayLineMatchesAddLane(line, { voucherToken, voucherAwardId })
      )
      .reduce((sum, line) => sum + line.quantity, 0);
    let sendQuantity = Math.max(1, Math.floor(quantity));
    if (isVoucherProduct) sendQuantity = 1;
    sendQuantity = Math.min(
      sendQuantity,
      SHARED_CART_MAX_QUANTITY_PER_LINE - existing
    );
    if (sendQuantity <= 0) return;
    tempCounterRef.current += 1;
    const tempId = `t${tempCounterRef.current}-${Date.now().toString(36)}`;
    dispatch({
      generation: generationRef.current,
      products: { [key]: product },
      type: 'products/hydrated',
    });
    enqueueIntent({
      kind: 'add',
      options,
      product,
      quantity: sendQuantity,
      tempId,
    });
  }

  function removeFromCart(
    cartItemIdOrProductId: string,
    variantId?: string
  ): void {
    if (!enabled) return;
    const current = stateRef.current;
    const index = findMatchingLineIndex(
      current.display,
      cartItemIdOrProductId,
      variantId
    );
    if (index === -1) return;
    const line = current.display[index];
    if (!line) return;
    enqueueIntent({ kind: 'remove', target: targetForLine(line) });
  }

  function updateQuantity(
    cartItemIdOrProductId: string,
    quantity: number,
    variantId?: string
  ): void {
    if (!enabled) return;
    if (quantity <= 0) {
      removeFromCart(cartItemIdOrProductId, variantId);
      return;
    }
    const current = stateRef.current;
    const index = findMatchingLineIndex(
      current.display,
      cartItemIdOrProductId,
      variantId
    );
    if (index === -1) return;
    const line = current.display[index];
    if (!line) return;
    const minimum = line.minimum_order_quantity ?? 1;
    const clamped = Math.min(
      SHARED_CART_MAX_QUANTITY_PER_LINE,
      Math.max(minimum, Math.floor(quantity))
    );
    enqueueIntent({
      kind: 'set_quantity',
      quantity: clamped,
      target: targetForLine(line),
    });
  }

  function clearCart(): void {
    if (!enabled) return;
    if (
      stateRef.current.confirmed &&
      isTerminalCart(stateRef.current.confirmed)
    )
      return;
    enqueueIntent({ kind: 'clear' });
  }

  function repriceLine(line: SharedCartDisplayItem, price?: number): void {
    if (!enabled) return;
    const generation = generationRef.current;
    const key = cartLineIdentity(cartItemToIdentity(line));
    const target = targetForLine(line);
    dispatch({
      generation,
      products: { [key]: line as unknown as Product },
      type: 'products/hydrated',
    });
    // One atomic in-place reprice: the server line, its quantity and
    // its identity never move, so an interrupted or rejected reprice
    // cannot lose the item the way a remove-then-add sequence could.
    enqueueIntent({
      kind: 'set_negotiated_price',
      negotiatedUnitPriceMinor: price == null ? null : Math.round(price * 100),
      target,
    });
  }

  function toggleAssurance(cartItemId: string): void {
    if (!enabled) return;
    const current = stateRef.current;
    const line = current.display.find((item) => item.cartItemId === cartItemId);
    if (!line) return;
    const hasAssurance = !(line.hasAssurance ?? false);
    // Persist the choice on the shared line so the checkout review and
    // the bound order carry the same coverage the shopper selected.
    enqueueIntent({
      hasAssurance,
      kind: 'set_assurance',
      target: targetForLine(line),
    });
  }
  return {
    enqueueIntent,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    repriceLine,
    toggleAssurance,
  };
}
