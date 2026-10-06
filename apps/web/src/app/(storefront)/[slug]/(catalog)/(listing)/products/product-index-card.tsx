import {
  formatCanonicalProductConditionLabel,
  normalizeCanonicalProductCondition,
} from '@baci/shared/lib';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { asRoute } from '@/lib/routes';
import { getProductUrl } from '@/lib/seo-utils';

interface ProductIndexCardProps {
  formattedPrice: string;
  pathPrefix: string;
  product: NormalizedProduct;
  modern?: boolean;
  footer?: ReactNode;
}

function hasRenderableImage(image?: string | null) {
  return typeof image === 'string' && image.trim() !== '';
}

function getConditionBadgeLabel(product: NormalizedProduct) {
  // Search cards price the matched option, so the badge names the matched
  // condition — not the parent's full set, which would advertise a used
  // price beneath "New & Used".
  const matchedCondition = product.searchMatch?.condition
    ? normalizeCanonicalProductCondition(product.searchMatch.condition)
    : '';
  if (matchedCondition) {
    return matchedCondition === 'new'
      ? null
      : (formatCanonicalProductConditionLabel(matchedCondition) ?? null);
  }
  if (Array.isArray(product.available_conditions)) {
    const normalizedConditions = Array.from(
      new Set(
        product.available_conditions
          .filter(
            (condition): condition is string => typeof condition === 'string'
          )
          .map((condition) => normalizeCanonicalProductCondition(condition))
          .filter(Boolean)
      )
    );

    if (
      normalizedConditions.length === 2 &&
      normalizedConditions.includes('new') &&
      normalizedConditions.includes('used')
    ) {
      return 'New & Used';
    }

    if (normalizedConditions.length === 1) {
      return normalizedConditions[0] === 'new'
        ? null
        : (formatCanonicalProductConditionLabel(normalizedConditions[0]) ??
            null);
    }

    if (normalizedConditions.length > 1) {
      return 'Multiple Conditions';
    }
  }

  if (product.has_condition_offers) {
    return 'New & Used';
  }

  const normalizedProductCondition =
    typeof product.condition === 'string'
      ? normalizeCanonicalProductCondition(product.condition)
      : '';

  return normalizedProductCondition && normalizedProductCondition !== 'new'
    ? (formatCanonicalProductConditionLabel(normalizedProductCondition) ?? null)
    : null;
}

export function ProductIndexCard({
  formattedPrice,
  pathPrefix,
  product,
  modern = false,
  footer,
}: ProductIndexCardProps) {
  const productPath = `${pathPrefix}${getProductUrl({
    id: product.id,
    name: product.name,
    slug: product.slug,
    category: product.category,
    category_slug: product.category_slug,
    canonical_url: product.canonical_url,
  })}`;
  const matchParams = new URLSearchParams();
  if (product.searchMatch?.variantId)
    matchParams.set('variant_id', product.searchMatch.variantId);
  if (product.searchMatch?.condition)
    matchParams.set('condition', product.searchMatch.condition);
  if (product.searchMatch?.offerId)
    matchParams.set('offer_id', product.searchMatch.offerId);
  const searchProductPath = matchParams.size
    ? `${productPath}?${matchParams}`
    : productPath;
  const conditionBadgeLabel = getConditionBadgeLabel(product);

  return (
    <article
      className={
        modern
          ? 'flex h-full flex-col overflow-hidden rounded-2xl border border-store-background-text/10 bg-store-background'
          : 'overflow-hidden rounded-3xl border border-store-background-text/10 bg-store-background shadow-sm transition-shadow hover:shadow-lg'
      }
    >
      <Link
        href={asRoute(searchProductPath)}
        prefetch={false}
        className={modern ? 'block flex-1' : 'block h-full'}
      >
        <div className="relative aspect-square bg-store-background-text/5">
          {hasRenderableImage(product.image) ? (
            <Image
              alt={product.name}
              className={modern ? 'object-contain p-3' : 'object-cover'}
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
              src={product.image}
            />
          ) : (
            <div
              role="img"
              aria-label={`No image available for ${product.name}`}
              className="flex h-full items-center justify-center px-4 text-center text-sm font-medium text-store-background-text/45"
            >
              Image coming soon
            </div>
          )}
          {conditionBadgeLabel && (
            <span
              className={
                modern
                  ? 'absolute top-2 left-2 rounded-md bg-store-background px-2 py-1 text-[11px] text-store-background-text'
                  : 'absolute top-2 right-2 rounded-full bg-store-primary px-2 py-0.5 text-xs font-bold uppercase text-white'
              }
            >
              {conditionBadgeLabel}
            </span>
          )}
        </div>

        <div className={modern ? 'space-y-2 p-3' : 'space-y-3 p-4'}>
          <div className="space-y-1">
            {!modern && product.category && (
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-store-primary/80">
                {product.category}
              </p>
            )}
            <h2
              className={
                modern
                  ? 'min-h-10 line-clamp-2 text-sm font-medium text-store-background-text'
                  : 'line-clamp-2 text-base font-semibold text-store-background-text'
              }
            >
              {product.name}
            </h2>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p
              className={
                modern
                  ? 'text-base font-bold text-store-background-text'
                  : 'text-sm font-semibold text-store-background-text'
              }
            >
              {formattedPrice}
            </p>
            {!modern && (
              <span className="text-xs font-medium text-store-background-text/45">
                View
              </span>
            )}
          </div>
        </div>
      </Link>
      {modern && (
        <div className="mx-3 flex items-center justify-between gap-2 border-t border-store-background-text/10 py-1.5">
          <div className="min-w-0 flex-1">{footer}</div>
          <Link
            prefetch={false}
            href={asRoute(searchProductPath)}
            aria-label={`Choose ${product.name} to buy`}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-store-background-text/5 px-2 text-xs font-medium text-store-background-text"
          >
            {product.variant_model === 'sku_matrix' ||
            product.has_condition_offers
              ? 'Options'
              : 'Buy'}
          </Link>
        </div>
      )}
    </article>
  );
}
