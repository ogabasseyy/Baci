import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import type { ProductKeySpecs } from '@/lib/products';
export interface FeedProduct {
  id: string;
  name: string;
  description: string;
  slug?: string;
  price: number;
  compare_at_price?: number;
  brand?: string;
  gtin?: string;
  mpn?: string;
  sku?: string;
  stock: number;
  stock_quantity?: number;
  manage_stock?: boolean | null;
  condition?: 'new' | 'used' | 'refurbished' | 'open_box' | 'uk_used' | null;
  condition_detail?: string;
  variant_model?: 'legacy' | 'sku_matrix';
  google_product_category?: string;
  category?: string | null;
  category_slug?: string | null;
  canonical_url?: string | null;
  color?: string;
  categories?: {
    name?: string;
    slug?: string;
  } | null;
  product_key_specs?: ProductKeySpecs | null;
  weight_value?: number;
  weight_unit?: 'kg' | 'lb' | 'g' | 'oz';
  updated_at?: string;
  has_condition_offers?: boolean;
  offers?: FeedOffer[];
  variants?: FeedVariant[];
}

export interface FeedOffer {
  images?: unknown;
  id: string;
  condition: 'new' | 'used' | 'refurbished' | 'open_box' | 'uk_used';
  price: number;
  stock_quantity?: number | null;
}

export interface FeedVariant {
  id: string;
  attributes?: Record<string, unknown> | null;
  condition?: 'new' | 'used' | 'refurbished' | 'open_box' | 'uk_used' | null;
  compare_at_price?: number | null;
  price?: number | null;
  price_override?: number | null;
  sku?: string | null;
  stock_quantity?: number | null;
}

export type FeedDefaultVariant = Omit<FeedVariant, 'attributes'> & {
  attributes?: Record<string, string> | null;
};

export interface FeedMerchant {
  id: string;
  business_name: string;
  country?: string;
  gmc_variants_enabled?: boolean;
  payout_currency?: string;
  slug: string;
}

/** Map of product_id → manifest entries for that product */
export type ImageManifestMap = Record<string, FeedImageManifestEntry[]>;
