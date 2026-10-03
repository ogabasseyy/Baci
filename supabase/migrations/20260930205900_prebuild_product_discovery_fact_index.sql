-- disable-transaction
-- Prebuild the exact index before the following IF NOT EXISTS migration.
-- This avoids catalog write blocking without rewriting that migration.
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_fact_search_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_discovery_fact_search_idx ON public.products
USING gin (jsonb_to_tsvector('simple'::regconfig, coalesce(discovery_metadata, '{}'::jsonb), '["string", "numeric"]'::jsonb))
WHERE status = 'active';
