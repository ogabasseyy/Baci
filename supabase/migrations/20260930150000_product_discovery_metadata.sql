-- Public search facts, separate from private product metadata and merchandising categories.
-- Existing product publication and merchant-write RLS remain authoritative.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS discovery_metadata jsonb;
ALTER TABLE public.products ADD CONSTRAINT products_discovery_metadata_object
  CHECK (discovery_metadata IS NULL OR
    (jsonb_typeof(discovery_metadata) = 'object' AND octet_length(discovery_metadata::text) <= 16384));
COMMENT ON COLUMN public.products.discovery_metadata IS
  'Merchant-verified public discovery facts: product_type, model, compatible_with and canonical attributes. Missing facts are unknown; never infer availability or price from this document.';
