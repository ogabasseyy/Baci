'use client';

import {
  cartLineIdentity,
  SHARED_CART_MAX_QUANTITY_PER_LINE,
} from '@baci/shared/cart';

import type { Product } from '@/lib/products';

import type { AddToCartOptions, SharedCartDisplayItem } from './cart-types';
import {
  findMatchingLineIndex,
  optionsFromLine,
  targetForLine,
} from './shared-cart-hook-support';
import {
  cartItemToIdentity,
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
    const isVoucherProduct = Boolean(
      options?.quizVoucherToken ||
        options?.quizAwardId ||
        (product as unknown as Record<string, unknown>).quizVoucherToken ||
        (product as unknown as Record<string, unknown>).isQuizPrize
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
        selectedColor: options?.color,
        selectedColorValue: options?.colorValue,
        selectedStorage: options?.storage,
        secondaryColor: options?.secondaryColor,
        secondaryColorValue: options?.secondaryColorValue,
        variantAttributes: options?.variantAttributes,
        variantId: options?.variantId,
      })
    );
    const existing = current.display
      .filter((line) => cartLineIdentity(cartItemToIdentity(line)) === key)
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
    enqueueIntent({ kind: 'clear' });
  }

  function repriceLine(line: SharedCartDisplayItem, price?: number): void {
    if (!enabled) return;
    const generation = generationRef.current;
    const key = cartLineIdentity(cartItemToIdentity(line));
    const target = targetForLine(line);
    const options = optionsFromLine(line);
    tempCounterRef.current += 1;
    const tempId = `t${tempCounterRef.current}-${Date.now().toString(36)}`;
    const attachments =
      price == null
        ? undefined
        : {
            negotiatedUnitPriceMinor: Math.round(price * 100),
            negotiationStatus: 'accepted' as const,
          };
    dispatch({
      generation,
      products: { [key]: line as unknown as Product },
      type: 'products/hydrated',
    });
    dispatch({
      generation,
      hasAssurance: line.hasAssurance ?? false,
      lineKey: key,
      type: 'assurance/overlay',
    });
    dispatch({
      entry: {
        intent: { kind: 'remove', target },
        operationId: crypto.randomUUID(),
      },
      generation,
      type: 'command/enqueue',
    });
    dispatch({
      entry: {
        intent: {
          attachments,
          kind: 'add',
          options,
          product: line as unknown as Product,
          quantity: Math.min(line.quantity, SHARED_CART_MAX_QUANTITY_PER_LINE),
          tempId,
        },
        operationId: crypto.randomUUID(),
      },
      generation,
      type: 'command/enqueue',
    });
  }

  function toggleAssurance(cartItemId: string): void {
    if (!enabled) return;
    const current = stateRef.current;
    const line = current.display.find((item) => item.cartItemId === cartItemId);
    if (!line) return;
    dispatch({
      generation: generationRef.current,
      hasAssurance: !(line.hasAssurance ?? false),
      lineKey: cartLineIdentity(cartItemToIdentity(line)),
      type: 'assurance/overlay',
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
