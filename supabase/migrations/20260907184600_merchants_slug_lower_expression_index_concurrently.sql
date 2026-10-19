-- disable-transaction
-- Expression index for lower(m.slug) lookups in get_order_tracking. CONCURRENTLY
-- avoids blocking merchant writes; disable-transaction is required because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_slug_lower
  ON public.merchants ((lower(slug)));
