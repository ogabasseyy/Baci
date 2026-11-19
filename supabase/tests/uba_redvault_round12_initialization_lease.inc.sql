-- Lease assertions share the caller's fixture and rollback transaction.
CREATE FUNCTION pg_temp.assert_redvault_initialization_leases(
  v_user uuid, v_merchant uuid, v_attempt_lease uuid,
  v_attempt_lease_stale uuid, v_attempt_lease_null uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_claimed boolean; v_claimed_at timestamptz;
BEGIN
  -- P1 (initialization lease): created claims; stale, NULL and fresh
  -- initializing leases remain fenced until authoritative reconciliation.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'storefront_order_context', 'route',
    'storefront_order_merchant_id', v_merchant::text,
    'storefront_redvault_customer_email', 'redvault-p12@example.com')::text, true);
  SELECT initialization_claimed INTO v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(v_attempt_lease);
  IF v_claimed IS NOT TRUE THEN
    RAISE EXCEPTION 'created attempt was not claimable';
  END IF;
  SELECT initialization_claimed_at INTO v_claimed_at
  FROM private.uba_redvault_payment_attempts WHERE id = v_attempt_lease_stale;
  SELECT initialization_claimed INTO v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(v_attempt_lease_stale);
  IF v_claimed IS NOT FALSE OR NOT EXISTS (
    SELECT 1 FROM private.uba_redvault_payment_attempts
    WHERE id = v_attempt_lease_stale AND state = 'initializing'
      AND initialization_claimed_at IS NOT DISTINCT FROM v_claimed_at
  ) THEN
    RAISE EXCEPTION 'stale initializing lease was reclaimed or changed';
  END IF;
  SELECT initialization_claimed INTO v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(v_attempt_lease_stale);
  IF v_claimed IS NOT FALSE THEN
    RAISE EXCEPTION 'repeated stale claim was accepted';
  END IF;
  SELECT initialization_claimed INTO v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(v_attempt_lease_null);
  IF v_claimed IS NOT FALSE OR NOT EXISTS (
    SELECT 1 FROM private.uba_redvault_payment_attempts
    WHERE id = v_attempt_lease_null AND state = 'initializing'
      AND initialization_claimed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'NULL-lease initializing row was reclaimed or changed';
  END IF;
  SELECT initialization_claimed INTO v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(v_attempt_lease);
  IF v_claimed IS NOT FALSE THEN
    RAISE EXCEPTION 'fresh initializing lease was reclaimed too early';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

END;
$$;
