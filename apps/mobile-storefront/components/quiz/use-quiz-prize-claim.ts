import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useProduct } from '@/hooks/use-product';
import type { QuizPrizeClaim } from '@/services/quiz';
import { useCartStore } from '@/stores/cart-store';
import { formatProductConditionDisplay } from '@/types/product';

const MIXED_CART_MESSAGE =
  'Your cart already has items. Check out or empty your cart first, then claim your prize so nothing is lost.';

interface UseQuizPrizeClaimResult {
  /** Add the won prize as a voucher line and open checkout. */
  claimPrize: () => void;
  /** Retry fetching the prize product after a load failure. */
  retry: () => void;
  /** Navigate to the cart so the shopper can resolve a mixed-cart block. */
  reviewCart: () => void;
  /** True while the prize product is still loading. */
  isPreparing: boolean;
  /** True once the prize product is ready to be claimed. */
  isReady: boolean;
  /** Product-fetch error message, if any. */
  error: string | null;
  /** Set when any cart item would block a prize-only checkout; the claim is
   *  refused until the shopper clears them. */
  blockedReason: string | null;
}

/**
 * Turns a signed quiz `prizeClaim` into a real cart hand-off. The prize product
 * is resolved by id (the storefront product query accepts a UUID identifier),
 * then added to the cart carrying `voucher_token`/`voucher_award_id` — the
 * existing cart + order pipeline forwards these to `/api/orders`, where the
 * voucher entitlement is verified and priced server-side. Navigation lands the
 * shopper directly in checkout to complete the claim.
 */
export function useQuizPrizeClaim(
  prizeClaim: QuizPrizeClaim
): UseQuizPrizeClaimResult {
  const router = useRouter();
  const { product, isLoading, error, refetch } = useProduct(
    prizeClaim.productId
  );
  // Live cart state so the block below auto-clears the moment the cart is empty
  // (e.g. after the shopper reviews the cart and removes or checks out the
  // existing items) — a now-eligible prize claim is never stranded behind the
  // "Review cart" state.
  const cartHasItems = useCartStore((state) => state.items.length > 0);
  const [claimAttemptedWhileMixed, setClaimAttemptedWhileMixed] =
    useState(false);
  const blockedReason =
    claimAttemptedWhileMixed && cartHasItems ? MIXED_CART_MESSAGE : null;

  const claimPrize = () => {
    if (!product) return;

    // A prize is redeemed as its OWN order. The orders API accepts exactly one
    // voucher line, and serialized prizes may return a pre-reserved order. Keep
    // the claim path one prize at a time so checkout never receives a cart it
    // must reject or partially ignore.
    if (useCartStore.getState().items.length > 0) {
      setClaimAttemptedWhileMixed(true);
      return;
    }
    setClaimAttemptedWhileMixed(false);

    const conditionDisplay = prizeClaim.condition
      ? formatProductConditionDisplay(prizeClaim.condition)
      : undefined;

    useCartStore.getState().addItem({
      product_id: prizeClaim.productId,
      slug: product.slug,
      variant_id: prizeClaim.variantId ?? undefined,
      // Display-only label for the cart UI; the top-level `condition` below
      // must stay the raw enum so it matches the value signed into the voucher.
      variant_attributes: conditionDisplay
        ? { condition: conditionDisplay }
        : undefined,
      name: product.name,
      brand: product.brand,
      // The prize is free: the voucher line must be priced 0 client-side (the
      // orders API trusts the submitted price for voucher-verified lines, and
      // the web path zeroes it the same way in build-order-items). Keep the
      // catalog price as compare_at so the cart shows the "was" amount.
      price: 0,
      // Order verification uses variant.price_override ?? product.price.
      // The normalized variant.price may be display-only when no override exists.
      catalog_price:
        product.variants?.find((variant) => variant.id === prizeClaim.variantId)
          ?.price_override ?? product.price,
      compare_at_price: product.compare_at_price ?? product.price,
      quantity: 1,
      image_url: product.image || product.images?.[0],
      // Raw enum ('new' | 'used' | ...) — the orders route compares this
      // directly against the condition signed into the voucher token.
      condition: prizeClaim.condition ?? undefined,
      voucher_token: prizeClaim.voucherToken,
      voucher_award_id: prizeClaim.awardId,
    });

    router.push('/checkout');
  };

  return {
    claimPrize,
    retry: () => {
      void refetch();
    },
    reviewCart: () => {
      router.push('/cart');
    },
    isPreparing: isLoading && !product,
    isReady: Boolean(product),
    error,
    blockedReason,
  };
}
