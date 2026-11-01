import { normalizeProductCondition } from '@/components/storefront/ogabassey/types';
import { parseOfferSnapshotAllocation } from '@/lib/offer-snapshot-allocation';

interface LcpRouteProductOfferInput {
  allocatable_stock?: number | string | null;
  condition: string;
  id: string;
  images?: string[];
  price: number | string | null;
  status: string;
  stock_quantity?: number | string | null;
}

interface LcpRouteProductProjectionInput {
  condition?: string | null;
  product_offers?: readonly LcpRouteProductOfferInput[] | null;
  product_variants?: readonly unknown[] | null;
}

function parseOfferNumber(
  value: number | string | null | undefined
): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildLcpRouteProductProjection({
  condition,
  product_offers: productOffers,
  product_variants: productVariants,
}: LcpRouteProductProjectionInput) {
  const productCondition = normalizeProductCondition(condition);
  const offers = productOffers?.flatMap((offer) => {
    const offerCondition = normalizeProductCondition(offer.condition);
    const price = parseOfferNumber(offer.price);
    if (
      offer.status !== 'active' ||
      !offerCondition ||
      price === null ||
      offerCondition === productCondition
    ) {
      return [];
    }

    return [
      {
        condition: offerCondition,
        ...(offer.allocatable_stock !== undefined
          ? {
              allocatable_stock: parseOfferSnapshotAllocation(
                offer.allocatable_stock
              ),
            }
          : {}),
        id: offer.id,
        images: offer.images,
        price,
        stock_quantity: parseOfferNumber(offer.stock_quantity) ?? 0,
      },
    ];
  });

  return {
    condition: productCondition,
    hasVariantMatrix:
      Array.isArray(productVariants) && productVariants.length > 0,
    offers,
  };
}
