'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useCart } from '@/hooks/cart';
import { useToast } from '@/hooks/use-toast';
import { fetchAndAddCartItems } from '@/lib/cart-link-transfer';
import { resolveGuestCartTransfer } from '@/lib/guest-cart-handoff';
import { CartPage } from './cart-page';

interface CartPageWrapperProps {
  merchantId: string;
  vatEnabled?: boolean;
  vatRate?: number;
}

/**
 * Cart page wrapper that handles item_id query parameter for direct add-to-cart links.
 * Supports URLs like: /cart?item_id=123 or /cart?item_id=123,456,789
 * Used by ChatGPT MCP integration and Google Shopping.
 */
export function CartPageWrapper({ merchantId, vatEnabled = false, vatRate = 7.5 }: CartPageWrapperProps) {
  const searchParams = useSearchParams();
  const { addToCart, cart, isHydrated } = useCart();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const processedRef = useRef(false);
  const blockedNoticeRef = useRef(false);

  useEffect(() => {
    const guestTransfer = resolveGuestCartTransfer(searchParams.get('guest_cart'));
    const itemIds = guestTransfer ? guestTransfer.itemIds : searchParams.get('item_id');
    const rawQuantity = searchParams.get('qty');
    const parsedQuantity = rawQuantity && /^\d+$/.test(rawQuantity) ? Number(rawQuantity) : 1;
    const quantity = Number.isSafeInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 10
      ? parsedQuantity
      : 1;
    const quizAwardId = searchParams.get('quiz_award_id')?.trim() || null;
    const quizVoucherToken =
      searchParams.get('quiz_voucher_token')?.trim() || null;
    const variantId = searchParams.get('variant_id')?.trim() || undefined;
    const condition = searchParams.get('condition')?.trim() || undefined;

    // Wait for the persisted cart to hydrate before processing. On a cold load
    // from a prize link the cart is empty until StorefrontCartProvider restores
    // localStorage in its own effect; running now would let the mixed-cart
    // guard read an empty cart and add the prize alongside a shopper's
    // already-persisted paid items (which the server then rejects). Gating on
    // `isHydrated` (and keeping it in the dep list) defers the single run until
    // the real cart is present. Only process once, and only if item_id exists.
    if (!isHydrated || !itemIds || processedRef.current) return;

    // Mixed-cart guard, BEFORE the link is marked processed: a prize is redeemed
    // as its OWN order (the server rejects a cart mixing the voucher with paid
    // items). If other items are present, notify once and return WITHOUT
    // consuming the link — once the shopper empties/checks out those items the
    // effect reruns (cart is a dep) and the prize can still be claimed, instead
    // of being permanently stuck behind `processedRef`. Re-claiming the SAME
    // award is fine (deduped in fetchAndAddCartItems).
    const hasQuizPrizeVoucher = Boolean(!guestTransfer && quizAwardId && quizVoucherToken);
    if (
      (hasQuizPrizeVoucher && cart.some((item) => item.quizAwardId !== quizAwardId)) ||
      (guestTransfer && cart.some((item) => item.quizAwardId))
    ) {
      if (!blockedNoticeRef.current) {
        blockedNoticeRef.current = true;
        toast({
          title: 'Check out your prize separately',
          description:
            'Your cart has other items. Check out or empty your cart first, then claim your prize.',
          variant: 'destructive',
        });
      }
      return;
    }
    blockedNoticeRef.current = false;
    processedRef.current = true;

    // A failed attempt releases the link so a later effect run (e.g. after the
    // cart changes) retries it instead of forcing a full page reload.
    void fetchAndAddCartItems({
      itemIds,
      quantity,
      guestQuantities: guestTransfer?.quantities,
      quizAwardId,
      quizVoucherToken,
      variantId,
      condition,
      merchantId,
      cart,
      addToCart,
      toast,
      setIsLoading,
    }).then((succeeded) => { if (!succeeded) processedRef.current = false; });
  }, [searchParams, merchantId, addToCart, cart, toast, isHydrated]);

  // Wait for persisted items before deciding whether the cart is empty.
  if (!isHydrated || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-store-background">
        <div className="text-center" role="status">
          <div className="mx-auto mb-4 size-12 animate-spin rounded-full border-4 border-store-background-text/18 border-t-(--store-primary)" />
          <p className="text-store-background-text/65">
            {isHydrated ? 'Adding items to cart…' : 'Loading your cart…'}
          </p>
        </div>
      </div>
    );
  }

  return <CartPage vatEnabled={vatEnabled} vatRate={vatRate} />;
}
