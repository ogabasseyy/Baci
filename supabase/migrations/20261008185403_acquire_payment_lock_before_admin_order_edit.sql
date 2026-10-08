-- Take the per-order payment advisory lock before the outermost admin-edit
-- wrapper locks the order row, matching the lock order used by payment
-- refresh and webhook RPCs (advisory, then row). The outer wrapper locks
-- the row first while inner wrappers take the advisory lock later, so an
-- edit racing a payment path could deadlock; acquiring it here makes the
-- inner acquisitions re-entrant no-ops.
ALTER FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  RENAME TO update_admin_order_with_transaction_discount_metadata_without_payment_lock;
REVOKE ALL ON FUNCTION public.update_admin_order_with_transaction_discount_metadata_without_payment_lock(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_admin_order_with_transaction_discount_metadata(
  p_order_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  RETURN public.update_admin_order_with_transaction_discount_metadata_without_payment_lock(
    p_order_id,
    p_payload
  );
END;
$$;

ALTER FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  IS 'Takes the per-order payment advisory lock, then applies an admin order edit with negotiated discount cleanup.';
