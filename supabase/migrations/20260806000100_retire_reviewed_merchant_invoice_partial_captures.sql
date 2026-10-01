-- Preserve verified Paystack captures that require review and retire the
-- generated DVA placeholder after a strict partial invoice payment succeeds.

ALTER FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) RENAME TO complete_merchant_invoice_partial_payment_v2;

REVOKE ALL ON FUNCTION public.complete_merchant_invoice_partial_payment_v2(
  uuid, uuid, text, numeric, numeric, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_merchant_invoice_partial_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_settlement_reference text,
  p_verified_gateway_fee numeric,
  p_payment_platform_fee numeric,
  p_gateway_response jsonb DEFAULT NULL,
  p_actor text DEFAULT 'gateway_webhook'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_error_code text;
  v_reason text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: complete_merchant_invoice_partial_payment requires service_role';
  END IF;

  SELECT public.complete_merchant_invoice_partial_payment_v2(
    p_transaction_id,
    p_order_id,
    p_settlement_reference,
    p_verified_gateway_fee,
    p_payment_platform_fee,
    p_gateway_response,
    p_actor
  ) INTO v_result;

  v_error_code := v_result ->> 'error_code';
  v_reason := v_result ->> 'reason';

  -- The gateway capture is real even when it can no longer be applied to the
  -- locked invoice balance. Retire it from pending/wedge processing while the
  -- transaction-scoped reconciliation review owns the unresolved allocation.
  IF v_error_code = 'AMOUNT_EXCEEDS_REMAINING_BALANCE'
    OR (v_result ->> 'outcome' = 'standard_completion'
      AND v_reason = 'order_terminal') THEN
    UPDATE public.transactions AS t
    SET
      status = 'completed',
      gateway_response = COALESCE(p_gateway_response, t.gateway_response),
      metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'merchant_invoice_partial_reviewed', true,
        'merchant_invoice_partial_reviewed_at', now(),
        'merchant_invoice_partial_actor', COALESCE(
          NULLIF(trim(p_actor), ''),
          'gateway_webhook'
        ),
        'wedge_sweep_resolution', 'merchant_invoice_partial_conflict_reviewed'
      ),
      updated_at = now()
    WHERE t.id = p_transaction_id
      AND t.order_id = p_order_id
      AND t.status IN ('pending', 'completed');
  END IF;

  IF v_result ->> 'outcome' = 'partial_recorded' THEN
    -- generate-dva creates a full-amount BAC-* placeholder without the DVA
    -- transfer metadata. The verified transfer has its own transaction, so the
    -- placeholder must not block a later manual payment of the balance.
    UPDATE public.transactions AS placeholder
    SET
      status = 'cancelled',
      metadata = COALESCE(placeholder.metadata, '{}'::jsonb) || jsonb_build_object(
        'superseded_by_transaction_id', p_transaction_id,
        'superseded_reason', 'merchant_invoice_partial_capture'
      ),
      updated_at = now()
    WHERE placeholder.order_id = p_order_id
      AND placeholder.id <> p_transaction_id
      AND placeholder.transaction_type = 'payment'
      AND placeholder.status = 'pending'
      AND lower(COALESCE(placeholder.gateway, '')) = 'paystack'
      AND placeholder.gateway_reference LIKE 'BAC-%'
      AND placeholder.metadata ->> 'dva_account_number' IS NULL;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) TO service_role;

COMMENT ON FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) IS
  'Records verified Paystack merchant-invoice partial captures, retires reviewed conflicts, and supersedes generated DVA placeholders.';
