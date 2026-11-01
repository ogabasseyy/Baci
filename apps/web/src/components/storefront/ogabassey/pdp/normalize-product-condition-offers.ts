import { parseOfferSnapshotAllocation } from '@/lib/offer-snapshot-allocation';
import {
  normalizeProductCondition,
  type ProductConditionOffer,
} from '@/components/storefront/ogabassey/types';

type RawConditionOffer = {
  compare_at_price?: number | string | null;
  condition: string;
  condition_notes?: string;
  grade?: string;
  id: string;
  images?: string[];
  price: number | string;
  stock_quantity?: number;
  allocatable_stock?: number | string | null;
};

function parseOfferPrice(value: number | string | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return null;
    }
    const parsed = Number(normalizedValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizeProductConditionOffers(
  offers: readonly RawConditionOffer[] | null | undefined,
  formatPrice: (value: number) => string
): ProductConditionOffer[] | undefined {
  if (offers == null) {
    return undefined;
  }

  return offers.flatMap((offer) => {
    const condition = normalizeProductCondition(offer.condition);
    if (!condition) {
      return [];
    }

    const rawPrice = parseOfferPrice(offer.price);
    if (rawPrice === null) {
      return [];
    }

    const compareAtRawPrice = parseOfferPrice(offer.compare_at_price);
    if (offer.compare_at_price != null && compareAtRawPrice === null) {
      return [];
    }
    const compareAtPrice =
      compareAtRawPrice === null ? undefined : formatPrice(compareAtRawPrice);

    return [
      {
        compare_at_price: compareAtPrice,
        condition,
        grade: offer.grade,
        id: offer.id,
        images: offer.images,
        notes: offer.condition_notes,
        price: formatPrice(rawPrice),
        rawPrice,
        ...(offer.allocatable_stock !== undefined && { allocatable_stock: parseOfferSnapshotAllocation(offer.allocatable_stock) }),
        stock: offer.stock_quantity,
      },
    ];
  });
}
