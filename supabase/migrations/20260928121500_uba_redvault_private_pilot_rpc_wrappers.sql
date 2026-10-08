-- PR #3555 round-5 review follow-up: split of 20260928120000 (part 4/5): pilot assertion and RPC wrappers.
CREATE FUNCTION private.assert_uba_redvault_private_pilot_active(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  policy private.uba_redvault_live_pilot_policy%ROWTYPE;
  application_id uuid;
  application_user_id uuid;
  application_product_bound boolean;
BEGIN
  SELECT * INTO STRICT policy FROM private.uba_redvault_live_pilot_policy WHERE singleton;
  SELECT application.id, application.user_id,
    EXISTS (SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
      WHERE allocation.application_id = application.id
        AND allocation.product_id = policy.product_id)
  INTO application_id, application_user_id, application_product_bound
  FROM private.uba_redvault_applications AS application
  WHERE application.order_id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_customer_context_required'; END IF;
  IF policy.enabled IS TRUE AND (application_user_id IS DISTINCT FROM policy.user_id
    OR application_product_bound IS NOT TRUE) THEN
    RAISE EXCEPTION 'redvault_pilot_order_binding_mismatch';
  END IF;
  IF application_user_id = policy.user_id OR application_product_bound IS TRUE THEN
    IF policy.reserved_attempt_id IS NOT NULL
      AND p_order_id IS DISTINCT FROM policy.reserved_order_id THEN
      RAISE EXCEPTION 'redvault_pilot_attempt_cap_reached';
    END IF;
  END IF;
  IF (application_user_id = policy.user_id OR application_product_bound IS TRUE)
    AND (policy.enabled IS NOT TRUE OR policy.expires_at <= pg_catalog.now()) THEN
    RAISE EXCEPTION 'redvault_pilot_disabled_or_expired';
  END IF;
END;
$$;
ALTER FUNCTION private.assert_uba_redvault_private_pilot_active(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.assert_uba_redvault_private_pilot_active(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid)
  RENAME TO reserve_storefront_redvault_payment_attempt_v3_pre_pilot;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v3_pre_pilot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(p_order_id uuid)
RETURNS TABLE (
  attempt_id uuid, reference text, amount_kobo bigint, currency text,
  quote_payload_hash text, state text, bank_code text, authorization_url text,
  paystack_subaccount_code text, platform_fee_kobo bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE receipt record;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('uba_redvault_private_live_pilot_global_cap', 0));
  PERFORM private.assert_uba_redvault_private_pilot_active(p_order_id);
  SELECT * INTO STRICT receipt FROM
    public.reserve_storefront_redvault_payment_attempt_v3_pre_pilot(p_order_id);
  RETURN QUERY SELECT receipt.attempt_id, receipt.reference, receipt.amount_kobo,
    receipt.currency, receipt.quote_payload_hash, receipt.state, receipt.bank_code,
    receipt.authorization_url, receipt.paystack_subaccount_code, receipt.platform_fee_kobo;
END;
$$;
ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid)
  TO authenticated;

ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  RENAME TO claim_redvault_initialization_v3_pre_pilot;
REVOKE ALL ON FUNCTION public.claim_redvault_initialization_v3_pre_pilot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(p_attempt_id uuid)
RETURNS TABLE (
  attempt_id uuid, reference text, amount_kobo bigint, currency text,
  quote_payload_hash text, state text, bank_code text, authorization_url text,
  initialization_claimed boolean, paystack_subaccount_code text, platform_fee_kobo bigint,
  split_retained_shipping_kobo bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE attempt_order_id uuid; receipt record;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  SELECT order_id INTO STRICT attempt_order_id
  FROM private.uba_redvault_payment_attempts WHERE id = p_attempt_id;
  PERFORM private.assert_uba_redvault_private_pilot_active(attempt_order_id);
  SELECT * INTO STRICT receipt FROM
    public.claim_redvault_initialization_v3_pre_pilot(p_attempt_id);
  RETURN QUERY SELECT receipt.attempt_id, receipt.reference, receipt.amount_kobo,
    receipt.currency, receipt.quote_payload_hash, receipt.state, receipt.bank_code,
    receipt.authorization_url, receipt.initialization_claimed,
    receipt.paystack_subaccount_code, receipt.platform_fee_kobo,
    receipt.split_retained_shipping_kobo;
END;
$$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  TO authenticated;
