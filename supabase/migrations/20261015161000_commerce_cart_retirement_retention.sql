-- Retire device tombstones past every credential replay window as
-- part of the terminal purge (Codex P2 on PR 3693): the final
-- search-path-normalized purge body plus bounded tombstone retention.
-- Normalize the terminal purge to the cart chain's empty search_path
-- convention for SECURITY DEFINER functions. All references were
-- already schema-qualified; this removes the remaining name-resolution
-- surface in interval comparisons.
CREATE OR REPLACE FUNCTION public.commerce_cart_purge_terminal_carts(
  p_max_age interval DEFAULT interval '90 days',
  p_batch integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
      AND c.updated_at < pg_catalog.now() - p_max_age
    ORDER BY c.updated_at
    LIMIT p_batch
  )
  DELETE FROM public.commerce_carts c
  USING doomed d
  WHERE c.id = d.id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  -- Device-retirement tombstones are write-once per randomly minted
  -- device principal and can never be reused, so they must not grow
  -- without bound either. Thirty days is beyond every replay window:
  -- grants are hard-capped at created_at + 7 days, proofs cannot
  -- outlive their grant, and scoped JWTs expire in hours.
  DELETE FROM public.commerce_cart_device_retirements r
  WHERE r.retired_at < now() - interval '30 days'
    AND (r.merchant_id, r.device_principal_id) IN (
      SELECT t.merchant_id, t.device_principal_id
      FROM public.commerce_cart_device_retirements t
      WHERE t.retired_at < now() - interval '30 days'
      ORDER BY t.retired_at
      LIMIT p_batch
    );
  RETURN deleted_count;
END
$$;

REVOKE ALL ON FUNCTION public.commerce_cart_purge_terminal_carts(interval, integer)
  FROM PUBLIC, anon, authenticated, commerce_cart_shopper;
GRANT EXECUTE ON FUNCTION public.commerce_cart_purge_terminal_carts(interval, integer)
  TO service_role;
