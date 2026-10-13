'use client';

import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { ChevronUp, ShoppingCart } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { ThemedButton } from '@/components/themed';
import { QuantityButton } from '@/components/ui/quantity-button';
import { useCart } from '@/hooks/use-cart';
import { useCurrency } from '@/hooks/use-currency';
import { useToast } from '@/hooks/use-toast';
import type { Product, ProductVariant } from '@/lib/products';
import { cn } from '@/lib/utils';

// Module-scope subscribe helpers for useSyncExternalStore — stable identities
// so React never tears down / re-attaches the listeners between renders.
function subscribeToWindowResize(callback: () => void) {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}

function subscribeToWindowScroll(callback: () => void) {
  window.addEventListener('scroll', callback, { passive: true });
  return () => window.removeEventListener('scroll', callback);
}

export interface StickyAddToCartProps {
  /** Product to add to cart */
  product: Product;
  /** Selected variant (for products with variants) */
  selectedVariant?: ProductVariant | null;
  /** Selected variant attributes */
  selectedAttributes?: Record<string, string>;
  /** Selected condition for offer-driven or conditioned variant products */
  selectedCondition?: string;
  /** Selected display price for the current condition / variant */
  selectedPrice?: number;
  /** Selected stock for the current condition / variant */
  selectedStock?: number;
  /** Minimum distance from top before showing (default: 400px) */
  showAfterScroll?: number;
  /** Custom class name */
  className?: string;
}

/**
 * Sticky Add-to-Cart Component (Mobile Only)
 *
 * Shows a fixed bottom bar on mobile devices when the user scrolls
 * past the main add-to-cart button, allowing them to add the product
 * to cart from anywhere on the page.
 *
 * Features:
 * - Only shows on mobile (< 768px)
 * - Appears after scrolling past threshold
 * - Shows product name, price, and quantity controls
 * - Animates in/out smoothly
 * - Includes scroll-to-top button
 */
export function StickyAddToCart({
  product,
  selectedVariant,
  selectedAttributes,
  selectedCondition,
  selectedPrice,
  selectedStock,
  showAfterScroll = 400,
  className,
}: StickyAddToCartProps) {
  const { formatCurrency } = useCurrency();
  const { cart, addToCart, updateQuantity } = useCart();
  const { toast } = useToast();

  const [quantity, setQuantity] = useState(product.minimum_order_quantity || 1);

  // Sync viewport width and scroll position from the window (an external
  // system) with useSyncExternalStore instead of mirroring them into state
  // from an effect. Server snapshots are false, matching the previous
  // initial-state behavior (hidden until measured on the client).
  const isMobile = useSyncExternalStore(
    subscribeToWindowResize,
    () => window.innerWidth < 768,
    () => false
  );
  const isVisible = useSyncExternalStore(
    subscribeToWindowScroll,
    () => window.scrollY > showAfterScroll,
    () => false
  );

  // Don't render on desktop
  if (!isMobile) return null;

  // Find cart item matching product and variant
  const cartItem = cart.find((item) => {
    if (selectedVariant) {
      return item.id === product.id && item.variantId === selectedVariant.id;
    }
    const effectiveSelectedCondition =
      normalizeCanonicalProductCondition(
        selectedCondition ?? product.condition
      ) || 'new';
    return (
      item.id === product.id &&
      !item.variantId &&
      (normalizeCanonicalProductCondition(
        item.condition ?? product.condition
      ) || 'new') === effectiveSelectedCondition
    );
  });

  // Get current price and stock based on variant selection
  const currentPrice =
    selectedPrice ?? selectedVariant?.price_override ?? product.price;
  const currentStock =
    selectedStock ?? selectedVariant?.stock_quantity ?? product.stock;
  const isOutOfStock = product.manage_stock && currentStock === 0;

  const handleQuantityChange = (newQuantity: number) => {
    const moq = product.minimum_order_quantity || 1;
    if (newQuantity >= moq) {
      setQuantity(newQuantity);
    }
  };

  const handleAddToCart = () => {
    const productToAdd =
      selectedVariant || selectedCondition
        ? { ...product, price: currentPrice }
        : product;

    addToCart(
      productToAdd,
      quantity,
      selectedVariant
        ? {
            condition: selectedCondition,
            variantId: selectedVariant.id,
            variantAttributes: selectedAttributes || {},
          }
        : selectedCondition
          ? { condition: selectedCondition }
          : undefined
    );

    const variantInfo = selectedVariant
      ? ` (${Object.values(selectedAttributes || {}).join(', ')})`
      : '';

    toast({
      title: 'Added to cart',
      description: `${quantity} x ${product.name}${variantInfo} has been added to your cart.`,
    });
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 md:hidden',
        'transform transition-transform duration-300 ease-in-out',
        isVisible ? 'translate-y-0' : 'translate-y-full',
        className
      )}
    >
      {/* Scroll to top button */}
      <button
        type="button"
        onClick={scrollToTop}
        className={cn(
          'absolute -top-12 right-4 w-10 h-10 rounded-full',
          'bg-white shadow-lg border flex items-center justify-center',
          'transition-opacity duration-200',
          isVisible ? 'opacity-100' : 'opacity-0'
        )}
        aria-label="Scroll to top"
      >
        <ChevronUp className="size-5" />
      </button>

      {/* Sticky bar */}
      <div className="bg-white border-t shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] safe-area-bottom">
        <div className="container px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            {/* Product Info */}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{product.name}</p>
              <p
                className="font-bold text-lg"
                style={{ color: 'var(--store-primary)' }}
              >
                {formatCurrency(currentPrice)}
              </p>
            </div>

            {/* Cart Controls */}
            {cartItem ? (
              <div className="flex items-center gap-2">
                <QuantityButton
                  type="minus"
                  onClick={() =>
                    updateQuantity(
                      selectedVariant?.id
                        ? product.id
                        : (cartItem.cartItemId ?? product.id),
                      cartItem.quantity - 1,
                      selectedVariant?.id
                    )
                  }
                  disabled={cartItem.quantity <= 1}
                  className="size-11 min-w-[44px] min-h-[44px] rounded-full"
                />
                <span className="w-8 text-center font-medium">
                  {cartItem.quantity}
                </span>
                <QuantityButton
                  type="plus"
                  onClick={() =>
                    updateQuantity(
                      selectedVariant?.id
                        ? product.id
                        : (cartItem.cartItemId ?? product.id),
                      cartItem.quantity + 1,
                      selectedVariant?.id
                    )
                  }
                  className="size-11 min-w-[44px] min-h-[44px] rounded-full"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* Quantity selector */}
                <div className="flex items-center gap-1">
                  <QuantityButton
                    type="minus"
                    onClick={() => handleQuantityChange(quantity - 1)}
                    disabled={quantity <= (product.minimum_order_quantity || 1)}
                    className="size-11 min-w-[44px] min-h-[44px] rounded-full"
                  />
                  <span className="w-6 text-center text-sm font-medium">
                    {quantity}
                  </span>
                  <QuantityButton
                    type="plus"
                    onClick={() => handleQuantityChange(quantity + 1)}
                    className="size-11 min-w-[44px] min-h-[44px] rounded-full"
                  />
                </div>

                {/* Add to Cart button */}
                <ThemedButton
                  colorRole="primary"
                  size="sm"
                  className="gap-1.5 px-4"
                  onClick={handleAddToCart}
                  disabled={isOutOfStock}
                >
                  <ShoppingCart className="size-4" />
                  {isOutOfStock ? 'Unavailable' : 'Add'}
                </ThemedButton>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
