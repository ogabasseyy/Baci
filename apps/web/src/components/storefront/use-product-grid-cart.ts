import { useCart } from '@/hooks/use-cart';
import { useToast } from '@/hooks/use-toast';
import type { Product } from '@/lib/products';

/**
 * Cart wiring for the storefront product grid: O(1) cart-item lookup for
 * the render loop plus the add-to-cart handler with toast. Extracted from
 * StorefrontProductGrid (modularity boundary); behavior is unchanged —
 * duplicate legacy IDs still resolve to the first match, and the merchant
 * slug is still stored for checkout.
 */
export function useProductGridCart(merchantSlug: string | undefined) {
  const { cart, addToCart, updateQuantity, setMerchantSlug } = useCart();
  const { toast } = useToast();

  // Optimization: Cart items map for O(1) lookup in render loop
  // Preserves existing behavior: if multiple items have same ID (legacy), use the first one found
  const cartItemsMap = (() => {
    const map = new Map();
    // Loop through cart to populate map. If duplicates exist, we keep the first one
    // to match .find() behavior which returns the first match.
    // However, Map.set overwrites, so we need to check if it exists first.
    for (const item of cart) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    }
    return map;
  })();

  const handleAddToCart = (product: Product) => {
    // Store merchant slug for checkout
    if (merchantSlug) {
      setMerchantSlug(merchantSlug);
    }
    addToCart(product);
    toast({
      title: 'Added to cart',
      description: `${product.name} has been added to your cart.`,
    });
  };

  return { cartItemsMap, handleAddToCart, updateQuantity };
}
