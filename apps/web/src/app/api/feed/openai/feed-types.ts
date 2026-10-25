import type { OpenAIFeedProduct } from '@/app/api/feed/openai/feed-data';

/**
 * Local alias for products after the OpenAI feed data query has normalized
 * Supabase rows into the route-level feed contract.
 */
export type Product = OpenAIFeedProduct;

export type ProductCondition = 'new' | 'used' | 'refurbished';

export interface Merchant {
  id: string;
  business_name: string;
  country?: string;
  custom_domain?: string;
  payout_currency?: string;
  slug: string;
  logo_url?: string;
  trust_profile?: import('@baci/shared').MerchantTrustProfileDraft | null;
}

/**
 * Legacy OpenAI JSONL feed item. This keeps string prices because the legacy
 * feed format expects currency-formatted values such as "50000.00 NGN".
 */
export interface OpenAIFeedItem {
  enable_search: boolean;
  enable_checkout: boolean;
  id: string;
  gtin?: string;
  mpn?: string;
  title: string;
  description: string;
  link: string;
  condition: ProductCondition;
  product_type?: string;
  brand?: string;
  image_link: string;
  additional_image_links?: string[];
  price: string;
  sale_price?: string;
  availability: 'in_stock' | 'out_of_stock' | 'preorder';
  quantity?: number;
  item_group_id?: string;
  listing_has_variations?: boolean;
  variant_dict?: Record<string, string>;
  color?: string;
  size?: string;
  shipping_weight?: string;
  merchant_name: string;
  merchant_url: string;
  privacy_policy_url?: string;
  shipping_policy_url?: string;
  terms_of_service_url?: string;
  return_policy_url?: string;
  return_days?: number;
  rating?: number;
}

/**
 * Current OpenAI product feed item. This format is intentionally not shape-
 * compatible with the legacy JSONL item because prices and availability are
 * structured for newer agent consumers.
 */
export interface CurrentOpenAIFeedItem {
  id: string;
  title: string;
  description: {
    plain: string;
  };
  url: string;
  media: Array<{ type: 'image'; url: string }>;
  variants: Array<{
    id: string;
    title: string;
    url: string;
    price: { amount: number; currency: string };
    list_price?: { amount: number; currency: string };
    availability: {
      available: boolean;
      status: 'in_stock' | 'out_of_stock';
      quantity: number | null;
    };
    condition: ProductCondition[];
    description?: { plain: string };
    media?: Array<{ type: 'image'; url: string }>;
    variant_options?: Array<{ name: string; value: string }>;
    categories: Array<{ value: string; taxonomy: 'merchant' }>;
  }>;
}
