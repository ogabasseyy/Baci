ALTER FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb)
  RENAME TO approve_and_complete_uba_redvault_payment_legacy_917;
REVOKE ALL ON FUNCTION public.approve_and_complete_uba_redvault_payment_legacy_917(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.approve_and_complete_uba_redvault_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_verified_evidence jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_transaction_status text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: approve_and_complete_uba_redvault_payment requires service_role';
  END IF;
  IF p_transaction_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'redvault_verified_completion_invalid_arguments';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT status INTO v_transaction_status
  FROM public.transactions
  WHERE id = p_transaction_id AND order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND OR (v_transaction_status IN ('pending', 'completed')) IS NOT TRUE THEN
    RAISE EXCEPTION 'redvault_verified_completion_transaction_state_invalid';
  END IF;
  RETURN public.approve_and_complete_uba_redvault_payment_legacy_917(
    p_transaction_id,
    p_order_id,
    p_verified_evidence
  );
END;
$$;
ALTER FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) TO service_role;
