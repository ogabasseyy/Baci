'use client';

import { getProductImageAlt } from '@baci/shared/lib';
import { Eye, Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import { ProductCardImage } from '@/components/optimized-image';
import { ThemedButton, ThemedCard } from '@/components/themed';
import { CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { CartItem } from '@/hooks/use-cart';
import { useCurrency } from '@/hooks/use-currency';
import type { Product } from '@/lib/products';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';

// 2026 Best Practice: Extend Product type to include joined category data
// This avoids 'any' casts and provides type safety for the categories join
export interface ProductWithCategory extends Product {
  categories?: { name: string } | null;
}

interface StorefrontProductCardProps {
  product: Product;
  cartItem?: CartItem;
  staggerClass: string;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onQuickView: (product: Product) => void;
  basePath?: string;
  priority?: boolean;
}

/**
 * Product Card for Storefront Grid
 * Relying on React Compiler for automatic memoization and performance optimizations.
 */
export function StorefrontProductCard({
  product,
  cartItem,
  staggerClass,
  onAddToCart,
  onUpdateQuantity,
  onQuickView,
  basePath = '',
  priority = false,
}: StorefrontProductCardProps) {
  const { formatCurrency } = useCurrency();

  // Derived values - React Compiler handles memoization automatically
  // Only show discount if compare_at_price > price AND percentage is at least 1%
  const discountPercentage =
    product.compare_at_price && product.compare_at_price > product.price
      ? Math.round(
          ((product.compare_at_price - product.price) /
            product.compare_at_price) *
            100
        ) || null // Convert 0 to null to hide 0% badges
      : null;

  const discountBadgeText = discountPercentage
    ? `-${discountPercentage}%`
    : null;

  const isLowStock =
    product.manage_stock &&
    product.stock <= (product.low_stock_threshold ?? 5) &&
    product.stock > 0;

  const isOutOfStock = product.manage_stock && product.stock === 0;

  // Extract category (handles both categories join and direct category)
  const productCategory =
    product.categories?.name || product.category || 'General';
  const productImageAlt = getProductImageAlt(product, {
    includeBrandFallback: false,
  });

  const handleAddToCart = () => {
    if (isOutOfStock) return;
    onAddToCart(product);
  };

  const handleQuickView = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onQuickView(product);
  };

  const cartControlId = cartItem?.cartItemId ?? product.id;

  const handleDecreaseQuantity = () => {
    if (cartItem && cartItem.quantity > 0) {
      onUpdateQuantity(cartControlId, cartItem.quantity - 1);
    }
  };

  const handleIncreaseQuantity = () => {
    if (cartItem) {
      // 2026 Best Practice: Validate against stock to prevent over-ordering
      const maxQty = product.manage_stock
        ? product.stock
        : Number.POSITIVE_INFINITY;
      if (cartItem.quantity >= maxQty) return;
      onUpdateQuantity(cartControlId, cartItem.quantity + 1);
    }
  };

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = Math.max(0, Number.parseInt(e.target.value, 10) || 0);
    // 2026 Best Practice: Clamp to available stock
    if (product.manage_stock) {
      value = Math.min(value, product.stock);
    }
    onUpdateQuantity(cartControlId, value);
  };

  return (
    <ThemedCard
      className={`glass-themed overflow-hidden hover-lift flex flex-col group/card animate-fade-in-up ${staggerClass}`}
      accentPosition="top"
    >
      <div className="relative group/image">
        <Link
          href={getStorefrontProductHref(product, basePath)}
          className="block"
        >
          <ProductCardImage
            src={product.imageLarge}
            alt={productImageAlt}
            data-ai-hint={product.imageHint}
            width={600}
            height={400}
            className="object-cover w-full h-auto aspect-video"
            category={productCategory}
            priority={priority}
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />

          {/* Product Badges */}
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {discountPercentage && (
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-md shadow-sm">
                {discountBadgeText}
              </span>
            )}
            {isLowStock && (
              <span className="bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded-md shadow-sm">
                LOW STOCK
              </span>
            )}
            {isOutOfStock && (
              <span className="bg-gray-800 text-white text-xs font-bold px-2 py-1 rounded-md shadow-sm">
                OUT OF STOCK
              </span>
            )}
          </div>
        </Link>

        {/* Quick View Button - Desktop Only */}
        {/* Extracted from Link to resolve invalid interactive nesting (WCAG 2.1 AA) */}
        {/* 2026 Accessibility: focus-visible makes button visible for keyboard users */}
        <button
          type="button"
          onClick={handleQuickView}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1.5 bg-white/95 backdrop-blur-xs text-gray-900 px-4 py-2 rounded-full text-sm font-medium shadow-lg opacity-0 group-hover/image:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary transition-all duration-200 hover:bg-white hover:scale-105"
          aria-label={`Quick view ${product.name}`}
        >
          <Eye className="size-4" aria-hidden="true" />
          Quick View
        </button>
      </div>

      <CardContent className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-lg">{product.name}</h3>
        <p className="text-muted-foreground text-sm mt-1 truncate flex-1">
          {product.description}
        </p>

        <div className="flex items-center justify-between mt-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="sr-only">Current price:</span>
            <p
              className="text-lg font-bold"
              style={{ color: 'var(--store-primary)' }}
            >
              {formatCurrency(product.price)}
            </p>
            {product.compare_at_price &&
              product.compare_at_price > product.price && (
                <>
                  <span className="sr-only">Original price:</span>
                  <p className="text-sm text-muted-foreground line-through">
                    {formatCurrency(product.compare_at_price)}
                  </p>
                </>
              )}
          </div>

          {cartItem ? (
            <div className="flex items-center gap-1">
              <ThemedButton
                colorRole="primary"
                size="icon"
                variant="outline"
                className="size-10 min-w-[44px] min-h-[44px]"
                onClick={handleDecreaseQuantity}
                disabled={cartItem.quantity <= 0}
                aria-label={`Decrease quantity of ${product.name}`}
              >
                <Minus className="size-4" aria-hidden="true" />
              </ThemedButton>
              <Input
                type="number"
                value={cartItem.quantity}
                onChange={handleQuantityChange}
                className="h-10 w-12 text-center remove-arrow"
                min="0"
                max={product.manage_stock ? product.stock : undefined}
                aria-label={`Quantity for ${product.name}`}
              />
              <ThemedButton
                colorRole="primary"
                size="icon"
                className="size-10 min-w-[44px] min-h-[44px]"
                onClick={handleIncreaseQuantity}
                disabled={
                  product.manage_stock && cartItem.quantity >= product.stock
                }
                aria-label={`Increase quantity of ${product.name}`}
              >
                <Plus className="size-4" aria-hidden="true" />
              </ThemedButton>
            </div>
          ) : (
            <ThemedButton
              colorRole="primary"
              size="sm"
              onClick={handleAddToCart}
              disabled={isOutOfStock}
              aria-disabled={isOutOfStock}
              aria-label={
                isOutOfStock
                  ? `Out of stock: ${product.name}`
                  : `Add ${product.name} to cart`
              }
            >
              {isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
            </ThemedButton>
          )}
        </div>
      </CardContent>
    </ThemedCard>
  );
}
