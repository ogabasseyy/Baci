BEGIN;

CREATE FUNCTION public.get_customer_savings_interest_snapshot(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT public.get_customer_savings_earnings(p_merchant_id, true)
    || jsonb_build_object(
      'interest_history',
      public.get_customer_savings_interest_history(p_merchant_id)->'interest_history'
    );
$$;

REVOKE ALL ON FUNCTION public.get_customer_savings_interest_snapshot(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_savings_interest_snapshot(uuid)
  TO authenticated;
COMMENT ON FUNCTION public.get_customer_savings_interest_snapshot(uuid) IS
  'Authenticated security-invoker snapshot combining earnings and history in one stable SQL statement snapshot.';

COMMIT;
