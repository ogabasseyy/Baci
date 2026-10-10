import type { useCart } from '@/hooks/cart';
import { findMergingCartLineIndex } from '@/hooks/cart/find-merging-cart-line';
import type { useToast } from '@/hooks/use-toast';
import { fetchCartLinkAnchorStock } from './cart-link-anchor-stock';
import {
  getPrimaryProductImage,
  PRODUCT_IMAGE_PLACEHOLDER_URL,
} from './product-image';
import { resolveGuestQuantityToAdd } from './resolve-guest-quantity-to-add';
import { rewriteCartLinkUrl } from './rewrite-cart-link-url';
import { createClient } from './supabase/client';

const QUIZ_PRIZE_PLATFORM = 'quiz_prize';
// Crafted legacy links reach the catalog in one query: bound them to the
// same 20-line budget the guest_cart path enforces upstream, plus a raw
// length ceiling so a megabyte of commas never reaches the split.
const MAX_CART_LINK_IDS = 20;
const MAX_CART_LINK_IDS_LENGTH = 2000;

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

    if (
      itemIds.length > MAX_CART_LINK_IDS_LENGTH ||
      ids.length > MAX_CART_LINK_IDS
    ) {
      toast({
        title: 'Invalid link',
        description: 'This cart link is invalid. Please try again.',
        variant: 'destructive',
      });
      return false;
    }

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

    // Shared anchor projection (see cart-link-anchor-stock): the chat
    // save and this website recheck evaluate the same anchor policy, and a
    // lookup failure keeps stored stock with rejections staying retryable.
    const anchorStock = await fetchCartLinkAnchorStock({
      supabase,
      merchantId,
      products: activeProducts,
    });

    // Lines the catalog no longer returns stay retryable in the link instead
    // of being silently consumed with the rest of the handoff. UUID text is
    // case-insensitive (Postgres accepts uppercase but returns lowercase),
    // so compare canonically: otherwise a found product is retained as
    // missing and every refresh adds it again.
    const returnedIds = new Set(
      activeProducts.map((product) => product.id.toLowerCase())
    );
    const missingIds = ids.filter((id) => !returnedIds.has(id.toLowerCase()));
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
    // Additive-only transfer keeps website lines that already exceed the
    // handoff target; the shopper gets one signal instead of silent skips.
    // (Chat removals are indistinguishable from website-side adds, so only
    // the provable target-below-existing case is flagged.)
    let keptHigherQuantity = false;
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
          // A retained handoff is consumed once the website cart holds an
          // option-bearing line for the product: the shopper followed the
          // instruction and selected options on the PDP, so re-rejecting on
          // every revisit would repeat the toast and pin the retry URL
          // forever instead of completing the promised later merge. Each
          // unmet need (variant selection, condition selection) must be
          // satisfied by some line; the handoff itself carries no variant,
          // so there is nothing further to top up.
          const optionNeedSatisfied =
            (!product.has_variants ||
              cart.some(
                (item) => item.id === product.id && item.variantId != null
              )) &&
            (!product.has_condition_offers ||
              cart.some(
                (item) => item.id === product.id && item.condition != null
              ));
          if (optionNeedSatisfied) continue;
          toast({
            title: 'Choose product options',
            description: `Choose the variant or condition for ${product.name} on its product page before adding it to your cart.`,
            variant: 'destructive',
          });
          // Option lines stay retryable on both the guest_cart and legacy
          // item_id paths: the shopper chooses options on the PDP and the
          // retained handoff line merges on a later visit instead of being
          // silently consumed here.
          rejectedIds.push(product.id);
          continue;
        }
        const anchor = anchorStock.projections.get(product.id.toLowerCase());
        // NULL means managed (legacy rows predate the flag): without this
        // an unconfigured product would skip the stock guard below and
        // carry a stale parent stock scalar into the cart.
        const managed = anchor?.manageStock ?? product.manage_stock ?? true;
        const effectiveStock = Number(
          anchor?.stockQuantity ?? product.stock_quantity ?? 0
        );
        const productForCart = {
          ...product,
          // The anchor overrides stored policy (then-unlimited unmanages
          // the line): addToCart gates on manage_stock, so a stale stored
          // flag would silently reject a purchasable line. Stock follows.
          manage_stock: managed,
          image: resolvedImage,
          imageLarge: resolvedImage,
          stock: anchor || managed ? effectiveStock : product.stock,
        };
        const existingIndex = findMergingCartLineIndex(cart, productForCart);
        const existingQuantity =
          existingIndex >= 0 ? cart[existingIndex].quantity : 0;
        const guestTarget = guestQuantities?.get(product.id.toLowerCase());
        const quantityToAdd = resolveGuestQuantityToAdd(
          guestTarget,
          existingQuantity,
          quantity
        );
        if (guestTarget !== undefined && guestTarget < existingQuantity)
          keptHigherQuantity = true;
        if (quantityToAdd === 0) continue;
        if (
          !hasQuizPrizeVoucher &&
          managed &&
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

    if (keptHigherQuantity) {
      toast({
        title: 'Kept your cart quantities',
        description:
          'Your cart already had higher quantities for some items, so those were kept instead of the chat amounts. Chat decreases never lower website quantities.',
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
