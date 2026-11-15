-- disable-transaction
-- Supporting index for brand authority inventory queries (merchant_id, status, brand)
-- and get_storefront_cluster_guide_candidates_v1 active product scans.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_merchant_status_brand_active
  ON public.products (merchant_id, status, lower(brand), updated_at DESC, id ASC)
  WHERE status = 'active';
