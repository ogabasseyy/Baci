-- Keep unpaid pickup reclaim behind the merchant-bound repair_pickup_receiver
-- capability. Ordinary anon/authenticated JWTs must not learn repair UUIDs or
-- ticket numbers from email + merchant alone.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'repair_pickup_receiver'
  ) THEN
    CREATE ROLE repair_pickup_receiver NOLOGIN;
  END IF;
END;
$migration$;

GRANT repair_pickup_receiver TO authenticator;
GRANT USAGE ON SCHEMA public TO repair_pickup_receiver;

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

  IF COALESCE(auth.jwt() ->> 'repair_pickup_receiver_context', '')
      IS DISTINCT FROM 'server-quote'
    OR COALESCE(
      auth.jwt() ->> 'repair_pickup_receiver_merchant_id',
      ''
    ) IS DISTINCT FROM p_merchant_id::text
  THEN
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
    AND repair.status NOT IN ('completed', 'cancelled', 'rejected')
    AND repair.created_at >= (now() - interval '2 hours')
  ORDER BY repair.created_at DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.find_resumable_repair_pickup(uuid, text) IS
  'Server-capability-only unpaid pickup repair reclaim; ordinary storefront JWTs receive no repair identifiers.';

REVOKE ALL ON FUNCTION public.find_resumable_repair_pickup(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver;
GRANT EXECUTE ON FUNCTION public.find_resumable_repair_pickup(uuid, text)
  TO repair_pickup_receiver;

NOTIFY pgrst, 'reload schema';
