'use client';

import { Eye, Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import { ThemedButton, ThemedCard } from '@/components/themed';
import { CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { CartItem } from '@/hooks/use-cart';
import { useCurrency } from '@/hooks/use-currency';
import type { Product } from '@/lib/products';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import type { ProjectedPilotImage } from './next-image-adapter';

// Lab-only clone of StorefrontProductCard
// (src/components/storefront/product-card.tsx) with ONLY the image element
// changed: <ProductCardImage> is replaced by the projected <picture>
// (explicit staged srcSets, no ?w&q loader params on immutable variants).
// All commerce JSX — badges, quick view, price, add-to-cart / quantity
// controls, handlers, hooks — is verbatim. The control arm renders the
// ORIGINAL StorefrontProductCard with the staged original URL; this clone
// renders the pilot arm. See lab-card-clone.test.tsx for the structural
// parity proof (clone-control vs original).
//
// Accepted deltas (documented, fetch-neutral):
// - No blur placeholder: the production blur style is next/image-internal
//   inline CSS (zero requests). Replicating framework internals in the lab
//   would couple the experiment to them; LCP/image-byte comparisons are
//   unaffected.
// - No error->fallback swap: client failure-path state; lab staging
//   guarantees the bytes exist (preflight asserts).

export {
  LAB_CARD_GEOMETRY,
  labCardSlot,
  labProductFixture,
} from './lab-fixtures';

export function LabProductCardImage({
  imageHint,
  projection,
}: {
  imageHint: string;
  projection: ProjectedPilotImage;
}) {
  return (
    <picture data-pilot-lab-card-image="true">
      {projection.sources.map((source) => (
        <source
          key={source.format}
          sizes={projection.sizes}
          srcSet={source.srcSet}
          type={`image/${source.format}`}
        />
      ))}
      <img
        src={projection.fallbackSrc}
        alt={projection.alt}
        data-ai-hint={imageHint}
        width={projection.width}
        height={projection.height}
        sizes={projection.sizes}
        loading={projection.loading}
        fetchPriority={projection.fetchPriority}
        decoding="async"
        className="object-cover w-full h-auto aspect-video"
      />
    </picture>
  );
}

interface LabStorefrontProductCardProps {
  product: Product;
  projection: ProjectedPilotImage;
  cartItem?: CartItem;
  staggerClass: string;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onQuickView: (product: Product) => void;
  basePath?: string;
}

export function LabStorefrontProductCard({
  product,
  projection,
  cartItem,
  staggerClass,
  onAddToCart,
  onUpdateQuantity,
  onQuickView,
  basePath = '',
}: LabStorefrontProductCardProps) {
  const { formatCurrency } = useCurrency();

  const discountPercentage =
    product.compare_at_price && product.compare_at_price > product.price
      ? Math.round(
          ((product.compare_at_price - product.price) /
            product.compare_at_price) *
            100
        ) || null
      : null;

  const discountBadgeText = discountPercentage
    ? `-${discountPercentage}%`
    : null;

  const isLowStock =
    product.manage_stock &&
    product.stock <= (product.low_stock_threshold ?? 5) &&
    product.stock > 0;

  const isOutOfStock = product.manage_stock && product.stock === 0;

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
      const maxQty = product.manage_stock
        ? product.stock
        : Number.POSITIVE_INFINITY;
      if (cartItem.quantity >= maxQty) return;
      onUpdateQuantity(cartControlId, cartItem.quantity + 1);
    }
  };

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = Math.max(0, Number.parseInt(e.target.value, 10) || 0);
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
          <LabProductCardImage
            imageHint={product.imageHint}
            projection={projection}
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
