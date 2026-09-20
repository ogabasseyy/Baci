-- Round-19 review fixes: the dedicated abandoned-draft cleanup RPC enforces
-- the same active-state exclusions as the batch trigger and the interactive
-- cancel RPCs. `initializing` (provider POST in flight), `indeterminate`
-- (provider timeout that may hold a transaction), and `initialized` (live
-- hosted URL) can all still capture, so a service-role cleanup invoking
-- this RPC must raise instead of cancelling and releasing fenced units.
CREATE OR REPLACE FUNCTION public.cancel_abandoned_uba_redvault_draft(
  p_order_id uuid,
  p_hours_threshold int DEFAULT 72
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_released integer := 0;
  v_cancelled boolean := false;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: cancel_abandoned_uba_redvault_draft requires service_role';
  END IF;
  IF p_hours_threshold IS NULL OR p_hours_threshold < 1 OR p_hours_threshold > 720 THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_threshold_invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND
    OR v_order.merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    OR v_order.payment_method IS DISTINCT FROM 'uba_redvault' THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_order_mismatch';
  END IF;
  IF v_order.payment_status NOT IN ('unpaid', 'cancelled') THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_state_invalid';
  END IF;
  -- Mirror the batch trigger and interactive cancel guards: an attempt
  -- that is ambiguous (initializing/indeterminate), live (initialized),
  -- held, in evidence review, or approved still represents funds in
  -- flight, so the draft cannot be cancelled and its fenced units cannot
  -- be released.
  IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
             WHERE attempt.order_id = p_order_id
               AND attempt.state IN ('initializing', 'indeterminate', 'initialized', 'captured_held', 'capture_evidence_review', 'approved')) THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_active';
  END IF;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_refunds AS refund
             JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
             WHERE attempt.order_id = p_order_id
               AND refund.state IN ('pending', 'processing', 'needs_reconciliation', 'processed')) THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_active';
  END IF;
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  IF v_order.payment_status = 'unpaid' THEN
    IF v_order.created_at >= pg_catalog.now() - (p_hours_threshold * interval '1 hour') THEN
      RAISE EXCEPTION 'redvault_abandoned_draft_not_stale';
    END IF;
    UPDATE public.orders SET payment_status = 'cancelled', updated_at = pg_catalog.now()
    WHERE id = p_order_id;
    v_cancelled := true;
  END IF;
  v_released := private.release_uba_redvault_abandoned_units(p_order_id);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
  RETURN jsonb_build_object('cancelled', v_cancelled, 'releasedUnitCount', v_released,
    'orderId', p_order_id);
END;
$$;
ALTER FUNCTION public.cancel_abandoned_uba_redvault_draft(uuid, int) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_abandoned_uba_redvault_draft(uuid, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_abandoned_uba_redvault_draft(uuid, int) TO service_role;

-- Every REDVAULT split initializes with Bearer [REDACTED] the Paystack
-- gateway fee is deducted from the platform (main account) share, while the
-- merchant subaccount settles the gross minus transaction_charge only. The
-- direct-split ledger row must reflect that reality: the verified gateway
-- fee is still recorded in the gateway_fee column for transparency, but it
-- is NOT deducted from the merchant net (or the refund-reversal base
-- derived from it). Deducting it understated every merchant's settlement
-- by exactly the account-borne fee.
CREATE OR REPLACE FUNCTION public.record_uba_redvault_direct_settlement(
  p_merchant_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_gateway text,
  p_gateway_reference text,
  p_gross_amount numeric,
  p_gateway_fee numeric,
  p_platform_fee numeric,
  p_description text,
  p_metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_wallet_id uuid;
  v_net_amount numeric;
  v_expected_date date;
  v_settlement_id uuid;
  v_method text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_uba_redvault_direct_settlement requires service_role';
  END IF;
  IF p_source_type = 'order' THEN
    SELECT o.payment_method INTO v_method FROM public.orders AS o WHERE o.id = p_source_id;
    IF v_method IS DISTINCT FROM 'uba_redvault' THEN
      RAISE EXCEPTION 'redvault_direct_settlement_order_mismatch';
    END IF;
  END IF;

  v_wallet_id := public.get_or_create_merchant_wallet(p_merchant_id);
  -- Account-borne gateway fee: Paystack deducts it from the platform share
  -- (Bearer [REDACTED]'account'), so the merchant subaccount settles gross
  -- minus transaction_charge. Record the fee, but do not deduct it here.
  v_net_amount := p_gross_amount - p_platform_fee;
  v_expected_date := public.calculate_settlement_date(p_gateway);

  INSERT INTO public.merchant_settlements (
    merchant_id, wallet_id, source_type, source_id, gateway,
    gateway_reference, gross_amount, gateway_fee, platform_fee, net_amount,
    payment_date, expected_settlement_date, description, status, metadata,
    settlement_notified
  ) VALUES (
    p_merchant_id, v_wallet_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee, p_platform_fee,
    v_net_amount, pg_catalog.now(), v_expected_date,
    COALESCE(p_description, 'Payment received'),
    'settled',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('redvault_direct_split', true),
    true
  )
  ON CONFLICT (source_type, source_id, gateway_reference)
    WHERE gateway_reference IS NOT NULL AND status != 'cancelled'
    DO NOTHING
  RETURNING id INTO v_settlement_id;

  RETURN v_settlement_id;
END;
$$;
ALTER FUNCTION public.record_uba_redvault_direct_settlement(uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_uba_redvault_direct_settlement(uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_uba_redvault_direct_settlement(uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb) TO service_role;
