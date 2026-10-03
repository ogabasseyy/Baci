/**
 * Product types for the mobile app
 * Mirrors the web storefront types for consistency
 */

export type ProductCondition =
  | 'new'
  | 'used'
  | 'open_box'
  | 'refurbished'
  | 'uk_used';

export type ProductConditionDisplay =
  | 'New'
  | 'Open Box'
  | 'Multiple Conditions'
  | 'Used'
  | 'New & Used';

const VARIANT_AXIS_LABEL_MAP: Record<string, string> = {
  color: 'Color',
  platform: 'Platform',
  ram: 'RAM',
  rom: 'ROM',
  sim_type: 'SIM Type',
  storage: 'Storage',
};

function normalizeProductLabelValue(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function formatVariantAxisLabel(
  axis: string | null | undefined
): string | undefined {
  const normalized = normalizeProductLabelValue(axis);
  if (!normalized) {
    return undefined;
  }

  if (VARIANT_AXIS_LABEL_MAP[normalized]) {
    return VARIANT_AXIS_LABEL_MAP[normalized];
  }

  return normalized
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function formatProductConditionDisplay(
  condition: ProductCondition | string | null | undefined
): ProductConditionDisplay | undefined {
  const normalized = normalizeProductLabelValue(condition);

  if (!normalized) {
    return undefined;
  }

  switch (normalized) {
    case 'new':
      return 'New';
    case 'used':
      return 'Used';
    case 'uk_used':
      return 'Used';
    case 'open_box':
      return 'Open Box';
    case 'refurbished':
      return 'Open Box';
    case 'multiple_conditions':
      return 'Multiple Conditions';
    case 'new_and_used':
    case 'new_&_used':
      return 'New & Used';
    default:
      return normalized
        .trim()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) =>
          char.toUpperCase()
        ) as ProductConditionDisplay;
  }
}

export interface ProductConditionOffer {
  id: string;
  condition: ProductCondition;
  price: number;
  compare_at_price?: number;
  stock_quantity?: number;
  images?: string[];
  condition_notes?: string;
  grade?: 'A' | 'B' | 'C' | 'D'; // For used items: A=Like new, D=Heavy wear
}

export interface Product {
  searchMatch?: import('@baci/shared/lib').RefinedSearchRow;
  id: string;
  merchant_id?: string;
  name: string;
  slug: string;
  description?: string;
  price: number;
  compare_at_price?: number;
  created_at?: string;
  image: string;
  images?: string[];
  brand?: string;
  category?: string;
  condition?: ProductCondition | ProductConditionDisplay;
  rating?: number;
  review_count?: number;
  in_stock?: boolean;
  manage_stock?: boolean;
  stock_quantity?: number;
  has_variants?: boolean;
  variant_model?: 'legacy' | 'sku_matrix';
  available_conditions?: ProductCondition[];
  colors?: (string | { name: string; value: string })[];
  color_images?: Record<string, string[]>;
  variant_attributes?: Record<string, string[]>;
  variants?: ProductVariant[];
  specifications?: Record<string, string>;
  // Condition offers (multiple conditions with different prices)
  has_condition_offers?: boolean;
  offers?: ProductConditionOffer[];
}

export interface ProductVariant {
  id: string;
  name: string;
  condition?: ProductCondition;
  sku?: string;
  price: number;
  compare_at_price?: number;
  price_override?: number;
  price_modifier?: number;
  primary_image?: string;
  image?: string;
  images?: string[];
  in_stock?: boolean;
  stock_quantity?: number;
  attributes?: Record<string, string>;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  image?: string;
  description?: string;
  product_count?: number;
}

export interface Banner {
  id: string;
  title: string;
  subtitle?: string;
  image: string;
  link?: string;
  background_color?: string;
}

const NGN_PRICE_FORMATTER = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format price in Nigerian Naira
 */
export function formatPrice(amount: number): string {
  return NGN_PRICE_FORMATTER.format(amount);
}

/**
 * Calculate discount percentage
 */
export function getDiscountPercentage(
  price: number,
  compareAtPrice?: number
): number | null {
  if (!compareAtPrice || compareAtPrice <= price) return null;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}
