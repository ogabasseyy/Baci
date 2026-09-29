export interface BlogRelatedProduct {
  category_slug?: string | null;
  id: string;
  name: string;
  price?: number | null;
  compare_at_price?: number | null;
  has_condition_offers?: boolean | null;
  has_variants?: boolean | null;
  has_purchasable_condition_offer?: boolean;
  has_purchasable_variant?: boolean;
  inventory_tracking_policy?: string | null;
  manage_stock?: boolean | null;
  max_variant_price?: number | null;
  min_variant_price?: number | null;
  offers?: Array<{
    compare_at_price?: number | null;
    price?: number | null;
    status?: string | null;
    stock_quantity?: number | null;
  }>;
  stock?: number | null;
  stock_quantity?: number | null;
  slug?: string | null;
  variants?: Array<{
    id?: string;
    inventory_tracking_policy?: string | null;
    price_override?: number | null;
    stock_quantity?: number | null;
  }>;
}
