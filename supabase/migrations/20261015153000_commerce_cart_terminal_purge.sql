-- Bounded retention for terminal carts (Codex P1 on PR 3693): expiry
-- only flips carts to 'expired', and no migration ever reclaimed rows,
-- so commerce_carts and its dependents grew without bound. Child tables
-- already declare ON DELETE CASCADE (audit-style references use
-- ON DELETE SET NULL), and bound orders keep their own rows because
-- orders hold no foreign key into carts. This purge deletes terminal
-- carts whose last update is older than the retention window, in
-- bounded batches, and is callable only by privileged operators.
CREATE OR REPLACE FUNCTION public.commerce_cart_purge_terminal_carts(
  p_max_age interval DEFAULT interval '90 days',
  p_batch integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF p_max_age IS NULL OR p_max_age < interval '30 days' THEN
    RAISE EXCEPTION 'cart retention window must be at least 30 days';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'cart purge batch must be between 1 and 10000';
  END IF;
  WITH doomed AS (
    SELECT c.id
    FROM public.commerce_carts c
    WHERE c.state IN ('completed', 'expired', 'canceled')
      AND c.updated_at < now() - p_max_age
    ORDER BY c.updated_at
    LIMIT p_batch
  )
  DELETE FROM public.commerce_carts c
  USING doomed d
  WHERE c.id = d.id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$$;

REVOKE ALL ON FUNCTION public.commerce_cart_purge_terminal_carts(interval, integer)
  FROM PUBLIC, anon, authenticated, commerce_cart_shopper;
GRANT EXECUTE ON FUNCTION public.commerce_cart_purge_terminal_carts(interval, integer)
  TO service_role;
