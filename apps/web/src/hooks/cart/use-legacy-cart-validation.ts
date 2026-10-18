'use client';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useRef } from 'react';
import { logger } from '@/lib/logger';
import type { CartItem } from './cart-types';
import {
  applyValidationResults,
  createCartHash,
  validateStorefrontCart,
} from './storefront-cart-validation';

/**
 * Debounced legacy price validation. Skipped while delegated (server
 * prices are authoritative) and voids a cart-wide negotiation whenever
 * validated drift or removals change the negotiated composition.
 */
export function useLegacyCartValidation({
  cart,
  cartWideNegotiationActive,
  delegated,
  isHydrated,
  isValidationActivated,
  setCart,
  setCartWideNegotiationActiveState,
  cartWideNegotiationActiveRef,
}: {
  cart: CartItem[];
  cartWideNegotiationActive: boolean;
  delegated: boolean;
  isHydrated: boolean;
  isValidationActivated: boolean;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setCartWideNegotiationActiveState: Dispatch<SetStateAction<boolean>>;
  cartWideNegotiationActiveRef: RefObject<boolean>;
}): void {
  const lastValidatedCartHashRef = useRef('');

  useEffect(() => {
    // Server prices are authoritative while delegated; legacy validation
    // would overwrite confirmed negotiated prices from a stale read.
    if (delegated) return;
    if (!isHydrated || !isValidationActivated || cart.length === 0) return;

    const cartHash = createCartHash(cart);
    if (cartHash === lastValidatedCartHashRef.current) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      lastValidatedCartHashRef.current = cartHash;

      try {
        const validation = await validateStorefrontCart(
          cart,
          controller.signal
        );
        if (!validation || controller.signal.aborted) {
          return;
        }

        // A cart-wide negotiation distributes one agreed total across all
        // lines, so any validated price drift voids the whole group deal — not
        // just the changed line. Reset the flag and clear every line's
        // negotiated price (applyValidationResults only clears the drifted one).
        // A drifted price OR a removed (invalid) line both change the negotiated
        // cart composition, so either voids the whole group deal.
        const resetGroup =
          cartWideNegotiationActive &&
          ((validation.priceChanges?.length ?? 0) > 0 ||
            (validation.invalidProductIds?.length ?? 0) > 0);

        setCart((previousCart) => {
          let updatedCart = applyValidationResults(previousCart, validation);
          if (resetGroup) {
            updatedCart = updatedCart.map((item) =>
              item.negotiatedPrice === undefined &&
              item.negotiationStatus === undefined
                ? item
                : {
                    ...item,
                    negotiatedPrice: undefined,
                    negotiationStatus: undefined,
                  }
            );
          }
          lastValidatedCartHashRef.current = createCartHash(updatedCart);
          return updatedCart;
        });

        if (resetGroup) {
          cartWideNegotiationActiveRef.current = false;
          setCartWideNegotiationActiveState(false);
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }

        logger.error({
          message: 'Cart validation error',
          error: error as Error,
        });
      }
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    cart,
    isHydrated,
    isValidationActivated,
    cartWideNegotiationActive,
    delegated,
    setCart,
    setCartWideNegotiationActiveState,
    cartWideNegotiationActiveRef,
  ]);
}
