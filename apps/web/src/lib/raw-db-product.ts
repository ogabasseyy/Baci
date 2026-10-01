import type { ProductKeySpecValue } from './product-key-specs-normalize';

export type ProductKeySpecsRecord = Record<string, ProductKeySpecValue>;

export interface RawDbProduct {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  images?: (string | { url?: string; alt?: string; order?: number })[];
  categories?:
    | { id?: string; name: string; slug: string }
    | { id?: string; name: string; slug: string }[]
    | null;
  // Support for Many-to-Many relation (preferred over single category_id)
  product_categories?: {
    categories: { id?: string; name: string; slug: string } | null;
  }[];
  category?: string; // Legacy TEXT field
  category_id?: string;
  category_slug?: string | null;
  brand?: string;
  price: number;
  compare_at_price?: number;
  condition?: string;
  stock?: number | string | null;
  stock_quantity?: number | string | null;
  manage_stock?: boolean | null;
  low_stock_threshold?: number | string | null;
  rating?: number;
  product_key_specs?: unknown;
  merchant_id?: string;
  status?: string;
  has_condition_offers?: boolean;
  available_conditions?: string[] | null;
  variant_model?: 'legacy' | 'sku_matrix' | null;
  // Allow additional fields
  [key: string]: unknown;
}

export function isRawDbProductRecord(
  product: unknown
): product is RawDbProduct {
  if (!product || typeof product !== 'object') {
    return false;
  }

  const candidate = product as Partial<RawDbProduct>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.price === 'number' &&
    Number.isFinite(candidate.price)
  );
}
