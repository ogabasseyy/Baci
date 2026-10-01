-- Public search facts, separate from private product metadata and merchandising categories.
-- Existing product publication and merchant-write RLS remain authoritative.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS discovery_metadata jsonb;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_discovery_metadata_object'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_discovery_metadata_object
      CHECK (discovery_metadata IS NULL OR
        (jsonb_typeof(discovery_metadata) = 'object' AND octet_length(discovery_metadata::text) <= 16384))
      NOT VALID;
  END IF;
END;
$$;
-- Left NOT VALID on purpose: validation scans the populated table, so it
-- runs in 20261001120000_validate_discovery_metadata.sql after this
-- transaction commits the ALTER TABLE lock.
COMMENT ON COLUMN public.products.discovery_metadata IS
  'Merchant-verified public discovery facts: product_type, model, compatible_with and canonical attributes. Missing facts are unknown; never infer availability or price from this document.';
