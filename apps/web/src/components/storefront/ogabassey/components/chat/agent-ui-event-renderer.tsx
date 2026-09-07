'use client';

import { requiresProductSelection } from '@baci/shared/lib';
import { Check, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/merchant';
import type { Product } from '@/lib/products';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import {
  storefrontAgentUiContract,
  type StorefrontAgentUiEvent,
  type StorefrontAgentUiProduct,
} from '@/schemas/storefront-agent-ui-contract';

const PRICE_FORMATTER = new Intl.NumberFormat('en-NG', {
  currency: 'NGN',
  maximumFractionDigits: 0,
  style: 'currency',
});

function needsSelection(product: StorefrontAgentUiProduct): boolean {
  // The PDP owns condition-aware cart options and minimum-order selection.
  if (product.condition?.trim() || (product.minimumOrderQuantity ?? 1) > 1) {
    return true;
  }
  return requiresProductSelection({
    available_conditions: product.availableConditions,
    has_condition_offers: product.hasConditionOffers,
    has_variants: product.hasVariants,
    variant_model: product.variantModel,
  });
}

function canAddProduct(product: StorefrontAgentUiProduct): boolean {
  if (needsSelection(product)) return false;
  return !product.manageStock || (product.stock ?? 0) > 0;
}

function requestedQuantity(product: StorefrontAgentUiProduct): number {
  return product.manageStock
    ? Math.min(product.quantity ?? 1, product.stock ?? 0)
    : product.quantity ?? 1;
}

function createCartProduct(product: StorefrontAgentUiProduct): Product {
  const image = product.imageUrl ?? '/placeholder.svg';

  return {
    brand: product.brand ?? '',
    category: product.category ?? undefined,
    description: product.description ?? '',
    gtin: '',
    has_variants: product.hasVariants,
    id: product.id,
    image,
    imageHint: `${product.name} product image`,
    imageLarge: image,
    images: product.imageUrl
      ? [{ alt: product.name, order: 0, url: product.imageUrl }]
      : [],
    manage_stock: product.manageStock,
    mpn: product.slug ?? product.id,
    name: product.name,
    price: product.price,
    slug: product.slug ?? undefined,
    status: 'active',
    stock: product.stock ?? 0,
  };
}

interface AgentUiEventRendererProps {
  events: StorefrontAgentUiEvent[];
}

/** Trusted component registry for temporary storefront-agent presentation. */
export function AgentUiEventRenderer({ events }: AgentUiEventRendererProps) {
  const { addToCart, cart, setIsCartOpen } = useCart();
  const merchantContext = useMerchantSafe();
  const addedProductIds = cart.map((item) => item.id);
  const validatedEvents = events.flatMap((event) => {
    const parsed = storefrontAgentUiContract.eventSchema.safeParse(event);
    return parsed.success ? [parsed.data] : [];
  });

  const handleAddToCart = (product: StorefrontAgentUiProduct) => {
    if (!canAddProduct(product) || addedProductIds.includes(product.id)) return;

    addToCart(createCartProduct(product), requestedQuantity(product));
    setIsCartOpen(true);
  };

  if (validatedEvents.length === 0) return null;

  return (
    <div className="mt-3 space-y-3" aria-label="Shopping assistant results">
      {validatedEvents.map((event, eventIndex) => (
        <section
          className="border-t border-[var(--store-border)] pt-3"
          key={`${event.type}-${event.intent}-${eventIndex}`}
        >
          <h4 className="mb-2 text-xs font-semibold text-[var(--store-text)]">
            {event.title}
          </h4>
          <div className="space-y-2">
            {event.products.map((product) => {
              const href = getStorefrontProductHref(
                {
                  category: product.category,
                  id: product.id,
                  name: product.name,
                  slug: product.slug ?? undefined,
                },
                merchantContext?.basePath ?? ''
              );
              const isAdded = addedProductIds.includes(product.id);
              const isOutOfStock =
                product.manageStock && (product.stock ?? 0) <= 0;

              return (
                <article
                  aria-label={product.name}
                  className="overflow-hidden rounded-xl border border-[var(--store-border)] bg-[var(--store-surface)]"
                  key={product.id}
                >
                  <div className="flex gap-3 p-2.5">
                    {product.imageUrl ? (
                      <CdnFormatImage
                        alt={product.name}
                        className="size-16 shrink-0 rounded-lg object-cover"
                        height={64}
                        sizes="64px"
                        src={product.imageUrl}
                        width={64}
                      />
                    ) : (
                      <div
                        aria-label={`No image available for ${product.name}`}
                        className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--store-text)_6%,transparent)] text-[10px] text-[var(--store-text-muted)]"
                        role="img"
                      >
                        No image
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium text-[var(--store-text)]">
                        {product.name}
                      </p>
                      {product.brand && (
                        <p className="mt-0.5 text-[11px] text-[var(--store-text-muted)]">
                          {product.brand}
                        </p>
                      )}
                      <p className="mt-1 text-sm font-bold text-[var(--store-primary)]">
                        {PRICE_FORMATTER.format(product.price)}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-[var(--store-border)] p-2.5">
                    <Link
                      className="flex items-center justify-center rounded-lg border border-[var(--store-primary)] px-2 py-2 text-xs font-semibold text-[var(--store-primary)]"
                      href={href}
                    >
                      View product
                    </Link>
                    {needsSelection(product) ? (
                      <Link
                        className="flex items-center justify-center rounded-lg bg-[var(--store-primary)] px-2 py-2 text-center text-xs font-semibold text-[var(--store-primary-foreground)]"
                        href={href}
                      >
                        Choose options
                      </Link>
                    ) : (
                      <button
                        className="flex items-center justify-center gap-1 rounded-lg bg-[var(--store-primary)] px-2 py-2 text-xs font-semibold text-[var(--store-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isAdded || isOutOfStock}
                        onClick={() => handleAddToCart(product)}
                        type="button"
                      >
                        {isAdded ? <Check size={14} /> : <ShoppingCart size={14} />}
                        {isAdded
                          ? 'Added'
                          : isOutOfStock
                            ? 'Out of stock'
                            : requestedQuantity(product) > 1
                              ? `Add ${requestedQuantity(product)} to cart`
                              : 'Add to cart'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
