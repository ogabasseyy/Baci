'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useCart } from '@/hooks/cart';
import { useToast } from '@/hooks/use-toast';
import {
  getPrimaryProductImage,
  PRODUCT_IMAGE_PLACEHOLDER_URL,
} from '@/lib/product-image';
import { createClient } from '@/lib/supabase/client';
import { CartPage } from './cart-page';

const QUIZ_PRIZE_PLATFORM = 'quiz_prize';

interface CartPageWrapperProps {
  merchantId: string;
  vatEnabled?: boolean;
  vatRate?: number;
}

interface FetchAndAddCartItemsOptions {
  itemIds: string;
  quizAwardId: string | null;
  quizVoucherToken: string | null;
  variantId?: string;
  condition?: string;
  merchantId: string;
  cart: ReturnType<typeof useCart>['cart'];
  addToCart: ReturnType<typeof useCart>['addToCart'];
  toast: ReturnType<typeof useToast>['toast'];
  setIsLoading: (loading: boolean) => void;
}

// Module-scope helper: keeps the try/finally out of the component body so
// React Compiler can memoize CartPageWrapper.
async function fetchAndAddCartItems({
  itemIds,
  quizAwardId,
  quizVoucherToken,
  variantId,
  condition,
  merchantId,
  cart,
  addToCart,
  toast,
  setIsLoading,
}: FetchAndAddCartItemsOptions): Promise<void> {
  const hasQuizPrizeVoucher = Boolean(quizAwardId && quizVoucherToken);

  // The mixed-cart guard runs in the caller BEFORE the prize link is marked
  // processed (see CartPageWrapper), so a blocked claim can still be redeemed
  // once the shopper empties/checks out their other items. By the time we get
  // here the cart is safe to add the prize to.

  setIsLoading(true);

  try {
    // Support comma-separated IDs: item_id=123,456,789
    const ids = itemIds.split(',').map(id => id.trim()).filter(Boolean);

    if (ids.length === 0) return;

    const supabase = createClient();

    // Fetch products by ID
    const { data: products, error } = await supabase
      .from('products')
      .select(
        'id, name, description, status, price, manage_stock, stock, brand, gtin, mpn, merchant_id, images, imageHint:image_hint'
      )
      .eq('merchant_id', merchantId)
      .in('id', ids)
      .eq('status', 'active');

    if (error) {
      console.error('Error fetching products:', error);
      toast({
        title: 'Error',
        description: 'Could not add items to cart. Please try again.',
        variant: 'destructive',
      });
      return;
    }

    if (!products || products.length === 0) {
      toast({
        title: 'Product not found',
        description: 'The requested product could not be found.',
        variant: 'destructive',
      });
      return;
    }

    const activeProducts = products.filter(
      (product) => product.status === 'active'
    );
    if (activeProducts.length === 0) {
      toast({
        title: 'Product not found',
        description: 'The requested product could not be found.',
        variant: 'destructive',
      });
      return;
    }

    // Add each product to cart
    let addedCount = 0;
    for (const product of activeProducts) {
      const resolvedImage =
        getPrimaryProductImage(product.images) ||
        PRODUCT_IMAGE_PLACEHOLDER_URL;
      // Check if already in cart
      const existsInCart = hasQuizPrizeVoucher
        ? cart.some(item => item.quizAwardId === quizAwardId)
        : cart.some(item => item.id === product.id && !item.quizAwardId);
      if (!existsInCart) {
        addToCart(
          {
            ...product,
            image: resolvedImage,
            imageLarge: resolvedImage,
          },
          1,
          hasQuizPrizeVoucher
            ? {
                condition,
                platform: QUIZ_PRIZE_PLATFORM,
                quizAwardId: quizAwardId ?? undefined,
                quizVoucherToken: quizVoucherToken ?? undefined,
                variantId,
              }
            : undefined
        );
        addedCount++;
      }
    }

    if (addedCount > 0) {
      toast({
        title: addedCount === 1 ? 'Added to cart' : `${addedCount} items added`,
        description: addedCount === 1
          ? `${activeProducts[0].name} has been added to your cart.`
          : `${addedCount} products have been added to your cart.`,
      });
    }

    // Clean up URL by removing item_id parameter
    const url = new URL(window.location.href);
    url.searchParams.delete('item_id');
    url.searchParams.delete('quiz_award_id');
    url.searchParams.delete('quiz_voucher_token');
    url.searchParams.delete('variant_id');
    url.searchParams.delete('condition');
    window.history.replaceState(
      {},
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch (err) {
    console.error('Error adding products to cart:', err);
    toast({
      title: 'Error',
      description: 'Something went wrong. Please try again.',
      variant: 'destructive',
    });
  } finally {
    setIsLoading(false);
  }
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
    const itemIds = searchParams.get('item_id');
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
    const hasQuizPrizeVoucher = Boolean(quizAwardId && quizVoucherToken);
    if (
      hasQuizPrizeVoucher &&
      cart.some((item) => item.quizAwardId !== quizAwardId)
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

    void fetchAndAddCartItems({
      itemIds,
      quizAwardId,
      quizVoucherToken,
      variantId,
      condition,
      merchantId,
      cart,
      addToCart,
      toast,
      setIsLoading,
    });
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
