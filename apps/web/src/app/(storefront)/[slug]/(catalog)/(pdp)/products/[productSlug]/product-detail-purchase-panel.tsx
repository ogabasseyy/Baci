import { Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import { ThemedButton } from '@/components/themed';
import { Input } from '@/components/ui/input';
import type { CartItem } from '@/hooks/cart/cart-types';
import type { Product } from '@/lib/products';
import { asRoute } from '@/lib/routes';

/**
 * PDP purchase controls: in-cart quantity stepper plus checkout link,
 * or the pre-add stepper plus Add to Cart. Split from
 * ProductDetailClient (modularity rule).
 */
export function ProductDetailPurchasePanel({
  product,
  cartItem,
  hasEffectiveVariant,
  effectiveVariantId,
  quantity,
  onQuantityChange,
  updateQuantity,
  getHref,
  isOutOfStock,
  routeOfferMissing,
  routeVariantMissing,
  hasCurrentVariantSelection,
  onAddToCart,
}: {
  product: Product;
  cartItem: CartItem | undefined;
  hasEffectiveVariant: boolean;
  effectiveVariantId: string | null | undefined;
  quantity: number;
  onQuantityChange: (newQuantity: number) => void;
  updateQuantity: (
    cartItemIdOrProductId: string,
    quantity: number,
    variantId?: string
  ) => void;
  getHref: (path: string) => string;
  isOutOfStock: boolean;
  routeOfferMissing: boolean;
  routeVariantMissing: boolean;
  hasCurrentVariantSelection: boolean;
  onAddToCart: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {cartItem ? (
        <div className="flex flex-col gap-2">
          {hasEffectiveVariant && (
            <p className="text-sm text-muted-foreground">
              Selected:{' '}
              {Object.values(cartItem.variantAttributes || {}).join(', ')}
            </p>
          )}
          <div className="flex items-center gap-2">
            <ThemedButton
              colorRole="accent"
              size="icon"
              variant="outline"
              className="size-10"
              onClick={() =>
                updateQuantity(
                  effectiveVariantId
                    ? product.id
                    : (cartItem.cartItemId ?? product.id),
                  cartItem.quantity - 1,
                  effectiveVariantId ?? undefined
                )
              }
              aria-label={`Decrease quantity of ${product.name}`}
            >
              <Minus className="size-4" aria-hidden="true" />
            </ThemedButton>
            <Input
              type="number"
              value={cartItem.quantity}
              onChange={(e) =>
                updateQuantity(
                  effectiveVariantId
                    ? product.id
                    : (cartItem.cartItemId ?? product.id),
                  Math.max(
                    Number.parseInt(e.target.value, 10) ||
                      product.minimum_order_quantity ||
                      1,
                    product.minimum_order_quantity || 1
                  ),
                  effectiveVariantId ?? undefined
                )
              }
              className="h-10 w-16 text-center text-base remove-arrow"
              min={product.minimum_order_quantity || 1}
              aria-label={`Quantity for ${product.name}`}
            />
            <ThemedButton
              colorRole="accent"
              size="icon"
              variant="default"
              className="size-10"
              onClick={() =>
                updateQuantity(
                  effectiveVariantId
                    ? product.id
                    : (cartItem.cartItemId ?? product.id),
                  cartItem.quantity + 1,
                  effectiveVariantId ?? undefined
                )
              }
              aria-label={`Increase quantity of ${product.name}`}
            >
              <Plus className="size-4" aria-hidden="true" />
            </ThemedButton>
          </div>
          {/* Route through the cart, not checkout: the cart carries
              the optional-service (assurance) disclosure and
              toggle, so a direct checkout link would let a
              default-on fee reach payment without an opt-out. */}
          <Link href={asRoute(getHref('/cart'))}>
            <ThemedButton size="lg" colorRole="primary" className="w-full">
              View Cart and Checkout
            </ThemedButton>
          </Link>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-1">
            <ThemedButton
              colorRole="accent"
              size="icon"
              variant="outline"
              className="size-10"
              onClick={() => onQuantityChange(quantity - 1)}
              aria-label={`Decrease quantity of ${product.name}`}
            >
              <Minus className="size-4" aria-hidden="true" />
            </ThemedButton>
            <Input
              type="number"
              value={quantity}
              onChange={(e) =>
                onQuantityChange(Number.parseInt(e.target.value, 10) || 0)
              }
              className="h-10 w-16 text-center text-base remove-arrow"
              min={product.minimum_order_quantity || 1}
              aria-label={`Quantity for ${product.name}`}
            />
            <ThemedButton
              colorRole="accent"
              size="icon"
              variant="default"
              className="size-10"
              onClick={() => onQuantityChange(quantity + 1)}
              aria-label={`Increase quantity of ${product.name}`}
            >
              <Plus className="size-4" aria-hidden="true" />
            </ThemedButton>
          </div>
          <ThemedButton
            size="lg"
            colorRole="primary"
            className="w-full"
            disabled={
              isOutOfStock ||
              routeOfferMissing ||
              routeVariantMissing ||
              (product.has_variants && !hasCurrentVariantSelection)
            }
            onClick={onAddToCart}
          >
            Add to Cart
          </ThemedButton>
        </div>
      )}
    </div>
  );
}
