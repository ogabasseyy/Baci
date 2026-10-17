export interface CartItem {
  id: string;
  product_id: string;
  slug: string;
  variant_id?: string;
  offer_id?: string;
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
  /**
   * Stamped when the line defaulted off only because the live
   * shipping-insurance setting had not loaded yet. Cleared once the
   * settings warm-up reconciles the line, or when the shopper toggles
   * assurance explicitly (their choice wins).
   */
  assurancePendingSetting?: boolean;
  assuranceRate?: number;
  voucher_token?: string;
  voucher_award_id?: string;
}
