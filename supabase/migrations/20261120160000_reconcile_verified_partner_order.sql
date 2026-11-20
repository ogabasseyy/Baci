-- The normal request client may call this RPC only with server-attested
-- evidence supplied by Baci's internal reconciliation ingress.
CREATE FUNCTION public.reconcile_verified_partner_order(
  p_submission_id uuid,
  p_merchant_id uuid,
  p_connection_id text,
  p_evidence jsonb,
  p_route_proof jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_capture jsonb;
  v_settlement jsonb;
  v_receipt jsonb;
  v_hold_reason text;
BEGIN
  IF p_connection_id IS NULL OR p_connection_id !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
     OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
     OR pg_column_size(p_evidence) > 8192
     OR pg_column_size(p_route_proof) > 16384
     OR private.verify_shipping_quote_route_proof(
       p_route_proof, 'reconcile_verified_partner_order', p_submission_id, p_merchant_id
     ) IS DISTINCT FROM true
     OR (p_route_proof->>'payload_text')::jsonb IS DISTINCT FROM jsonb_build_object(
       'connection_id', p_connection_id, 'evidence', p_evidence
     ) THEN
    RAISE EXCEPTION 'invalid_partner_reconciliation_proof' USING ERRCODE = '42501';
  END IF;

  v_capture := p_evidence->'capture';
  v_settlement := p_evidence->'settlement';
  v_receipt := private.record_verified_partner_capture(
    p_submission_id, p_merchant_id, p_connection_id, (p_evidence->>'quote_id')::uuid,
    p_evidence->>'partner_order_id', v_capture->>'source', v_capture->>'provider_account',
    v_capture->>'reference', (v_capture->>'amount_minor')::bigint,
    v_capture->>'currency', (v_capture->>'captured_at')::timestamptz
  );

  v_hold_reason := v_receipt->>'review_reason';
  IF v_receipt->>'status' = 'accepted'
     OR v_hold_reason = 'ORDER_REVIEW_REQUIRED'
     OR v_settlement IS NULL OR v_settlement = 'null'::jsonb THEN
    RETURN jsonb_build_object('receipt', v_receipt, 'hold_reason', v_hold_reason);
  END IF;

  BEGIN
    v_receipt := private.record_verified_partner_settlement(
      p_submission_id, p_merchant_id, p_connection_id, v_settlement->>'source',
      v_settlement->>'settlement_account', v_settlement->>'payout_reference',
      v_settlement->>'allocation_reference', (v_settlement->>'amount_minor')::bigint,
      v_settlement->>'currency', (v_settlement->>'settled_at')::timestamptz
    );
    -- A corrected, independently verified allocation can resolve a settlement hold.
    DELETE FROM private.partner_order_review_holds
    WHERE submission_id = p_submission_id AND reason = 'SETTLEMENT_REVIEW_REQUIRED';
    v_hold_reason := NULL;
  EXCEPTION WHEN invalid_parameter_value OR unique_violation THEN
    v_hold_reason := 'SETTLEMENT_REVIEW_REQUIRED';
  END;

  IF v_hold_reason IS NULL THEN
    BEGIN
      v_receipt := private.accept_settled_partner_order(p_submission_id, p_merchant_id, p_connection_id);
    EXCEPTION WHEN invalid_parameter_value OR raise_exception THEN
      -- Roll back the order and stock mutation while preserving paid evidence.
      IF SQLSTATE = 'P0001' AND SQLERRM NOT IN (
        'insufficient_stock', 'insufficient_variant_stock', 'insufficient_condition_offer_stock',
        'invalid_condition_offer', 'invalid_variant', 'product_not_found',
        'condition_offer_price_changed', 'order_total_mismatch', 'tax_amount_mismatch'
      ) THEN
        RAISE;
      END IF;
      v_hold_reason := 'ORDER_REVIEW_REQUIRED';
    END;
  END IF;

  IF v_hold_reason IS NOT NULL THEN
    INSERT INTO private.partner_order_review_holds (submission_id, reason)
    VALUES (p_submission_id, v_hold_reason)
    ON CONFLICT (submission_id) DO UPDATE SET reason = EXCLUDED.reason;
    SELECT private.partner_order_receipt(s) INTO STRICT v_receipt
    FROM private.partner_order_submissions AS s WHERE s.id = p_submission_id;
  END IF;

  RETURN jsonb_build_object('receipt', v_receipt, 'hold_reason', v_hold_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_verified_partner_order(uuid, uuid, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_verified_partner_order(uuid, uuid, text, jsonb, jsonb)
  TO anon, authenticated;
