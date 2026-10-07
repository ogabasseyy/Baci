import type { useCart } from '@/hooks/cart';
import { findMergingCartLineIndex } from '@/hooks/cart/find-merging-cart-line';
import type { useToast } from '@/hooks/use-toast';
import {
  resolveGuestQuantityToAdd,
  rewriteCartLinkUrl,
} from './guest-cart-handoff';
import {
  getPrimaryProductImage,
  PRODUCT_IMAGE_PLACEHOLDER_URL,
} from './product-image';
import { createClient } from './supabase/client';

const QUIZ_PRIZE_PLATFORM = 'quiz_prize';

export interface FetchAndAddCartItemsOptions {
  itemIds: string;
  quantity: number;
  guestQuantities?: Map<string, number>;
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

// Fetches link products and merges them into the website cart. Returns false
// when the lookup itself failed so the caller can release the link for retry;
// a partial transfer still returns true with the retryable lines kept in the
// URL. Kept out of the component body so React Compiler can memoize it.
export async function fetchAndAddCartItems({
  itemIds,
  quantity,
  guestQuantities,
  quizAwardId,
  quizVoucherToken,
  variantId,
  condition,
  merchantId,
  cart,
  addToCart,
  toast,
  setIsLoading,
}: FetchAndAddCartItemsOptions): Promise<boolean> {
  const hasQuizPrizeVoucher = Boolean(
    !guestQuantities && quizAwardId && quizVoucherToken
  );

  // The mixed-cart guard runs in the caller BEFORE the prize link is marked
  // processed (see CartPageWrapper), so a blocked claim can still be redeemed
  // once the shopper empties/checks out their other items. By the time we get
  // here the cart is safe to add the prize to.

  setIsLoading(true);

  try {
    // Support comma-separated IDs: item_id=123,456,789
    const ids = itemIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (ids.length === 0) return true;

    const supabase = createClient();

    // Fetch products by ID
    const { data: products, error } = await supabase
      .from('products')
      .select(
        'id, name, description, status, price, manage_stock, stock, stock_quantity, has_variants, has_condition_offers, brand, gtin, mpn, merchant_id, images, imageHint:image_hint'
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
      return false;
    }

    if (!products || products.length === 0) {
      toast({
        title: 'Product not found',
        description: 'The requested product could not be found.',
        variant: 'destructive',
      });
      return false;
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
      return false;
    }

    // Lines the catalog no longer returns stay retryable in the link instead
    // of being silently consumed with the rest of the handoff.
    const returnedIds = new Set(activeProducts.map((product) => product.id));
    const missingIds = ids.filter((id) => !returnedIds.has(id));
    if (missingIds.length > 0) {
      toast({
        title: 'Some items unavailable',
        description: 'One or more linked items are no longer available.',
        variant: 'destructive',
      });
    }

    // Add each product to cart
    let addedCount = 0;
    let firstAddedProductName: string | null = null;
    const rejectedIds: string[] = [...missingIds];
    for (const product of activeProducts) {
      const resolvedImage =
        getPrimaryProductImage(product.images) || PRODUCT_IMAGE_PLACEHOLDER_URL;
      // Prize awards are single-use; ordinary cart lines merge in addToCart.
      const alreadyClaimedPrize =
        hasQuizPrizeVoucher &&
        cart.some((item) => item.quizAwardId === quizAwardId);
      if (!alreadyClaimedPrize) {
        if (
          !hasQuizPrizeVoucher &&
          (product.has_variants || product.has_condition_offers)
        ) {
          toast({
            title: 'Choose product options',
            description: `Choose the variant or condition for ${product.name} on its product page before adding it to your cart.`,
            variant: 'destructive',
          });
          continue;
        }
        const effectiveStock = Number(product.stock_quantity ?? 0);
        const productForCart = {
          ...product,
          image: resolvedImage,
          imageLarge: resolvedImage,
          stock: product.manage_stock ? effectiveStock : product.stock,
        };
        const existingIndex = findMergingCartLineIndex(cart, productForCart);
        const existingQuantity =
          existingIndex >= 0 ? cart[existingIndex].quantity : 0;
        const quantityToAdd = resolveGuestQuantityToAdd(
          guestQuantities?.get(product.id),
          existingQuantity,
          quantity
        );
        if (quantityToAdd === 0) continue;
        if (
          !hasQuizPrizeVoucher &&
          product.manage_stock &&
          existingQuantity + quantityToAdd > effectiveStock
        ) {
          rejectedIds.push(product.id);
          toast({
            title: 'Not enough stock',
            description: `Only ${effectiveStock} unit${effectiveStock === 1 ? '' : 's'} of ${product.name} are currently available. Adjust your cart, then reload to retry this link.`,
            variant: 'destructive',
          });
          continue;
        }
        addToCart(
          productForCart,
          hasQuizPrizeVoucher ? 1 : quantityToAdd,
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
        firstAddedProductName ??= product.name;
      }
    }

    if (addedCount > 0) {
      toast({
        title: addedCount === 1 ? 'Added to cart' : `${addedCount} items added`,
        description:
          addedCount === 1
            ? `${firstAddedProductName} has been added to your cart.`
            : `${addedCount} products have been added to your cart.`,
      });
    }

    // Keep only retryable stock failures in the handoff URL.
    window.history.replaceState(
      {},
      '',
      rewriteCartLinkUrl(window.location.href, guestQuantities, rejectedIds)
    );
    return true;
  } catch (err) {
    console.error('Error adding products to cart:', err);
    toast({
      title: 'Error',
      description: 'Something went wrong. Please try again.',
      variant: 'destructive',
    });
    return false;
  } finally {
    setIsLoading(false);
  }
}
