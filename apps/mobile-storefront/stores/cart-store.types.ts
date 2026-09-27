export interface CartItem {
  id: string;
  product_id: string;
  slug: string;
  variant_id?: string;
  variant_attributes?: Record<string, string>;
  name: string;
  brand?: string;
  price: number;
  /** Catalog unit price retained for a zero-priced quiz voucher line. */
  catalog_price?: number;
  compare_at_price?: number;
  quantity: number;
  image_url?: string;
  variant_name?: string;
  color?: string;
  storage?: string;
  condition?: string;
  max_quantity?: number;
  negotiatedPrice?: number;
  negotiationStatus?: 'pending' | 'accepted' | 'rejected';
  hasAssurance?: boolean;
  assuranceRate?: number;
  voucher_token?: string;
  voucher_award_id?: string;
}
