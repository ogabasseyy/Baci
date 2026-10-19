-- Storefront-safe resumable unpaid pickup lookup. Ordinary anon JWTs cannot
-- SELECT repairs; retries must go through this SECURITY DEFINER projection so
-- matching customer email can reclaim an unpaid pickup ticket without
-- creating duplicates.
CREATE OR REPLACE FUNCTION public.find_resumable_repair_pickup(
  p_merchant_id uuid,
  p_customer_email text
)
RETURNS TABLE (
  id uuid,
  ticket_number integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_customer_email, '')));
  v_allowed boolean := true;
BEGIN
  IF p_merchant_id IS NULL OR v_email = '' THEN
    RETURN;
  END IF;

  BEGIN
    v_allowed := public.check_rate_limit(
      'repair-resumable-pickup:' || p_merchant_id::text || ':' || v_email,
      'repair_resumable_pickup_rpc',
      30,
      60
    );
  EXCEPTION WHEN OTHERS THEN
    v_allowed := true;
  END;

  IF NOT v_allowed THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    repair.id,
    repair.ticket_number
  FROM public.repairs AS repair
  WHERE repair.merchant_id = p_merchant_id
    AND lower(repair.customer_email) = v_email
    AND repair.service_type = 'pickup'
    AND repair.pickup_payment_reference IS NULL
    AND repair.shipment_id IS NULL
    AND repair.created_at >= (now() - interval '2 hours')
  ORDER BY repair.created_at DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.find_resumable_repair_pickup(uuid, text) IS
  'Enumeration-safe unpaid pickup repair reclaim for storefront payment retries; returns at most one recent unpaid pickup ticket for the merchant + email match.';

REVOKE ALL ON FUNCTION public.find_resumable_repair_pickup(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_resumable_repair_pickup(uuid, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
