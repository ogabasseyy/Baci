-- Preserve the first open duplicate-capture review while recording each
-- additional verified capture on the same order. A second sweep worker
-- must not overwrite it. Every merged capture carries its full provider
-- evidence (amount, currency, status): the row is stamped and never
-- reselected, so without them operations cannot reconcile a later
-- charge whose provider evidence differs from the local transaction.
DROP FUNCTION IF EXISTS public.merge_duplicate_payment_capture_evidence_v1(uuid,uuid,uuid,text,text,text,text);
CREATE FUNCTION public.merge_duplicate_payment_capture_evidence_v1(
  p_order_id uuid,
  p_merchant_id uuid,
  p_transaction_id uuid,
  p_gateway_reference text,
  p_gateway text,
  p_charge_id text,
  p_reason text,
  p_provider_amount numeric,
  p_provider_currency text,
  p_provider_status text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL OR p_merchant_id IS NULL
    OR p_transaction_id IS NULL
    OR nullif(btrim(coalesce(p_gateway_reference, '')), '') IS NULL
    OR nullif(btrim(coalesce(p_gateway, '')), '') IS NULL
    OR nullif(btrim(coalesce(p_charge_id, '')), '') IS NULL
    OR nullif(btrim(p_reason), '') IS NULL
    OR p_provider_amount IS NULL
    OR nullif(btrim(coalesce(p_provider_currency, '')), '') IS NULL
    OR nullif(btrim(coalesce(p_provider_status, '')), '') IS NULL THEN
    RETURN false;
  END IF;
  -- The wedge sweep files duplicate captures for every healable gateway,
  -- so the merge must accept each of them: restricting this to Paystack
  -- would fail every merged Korapay/Juicyway capture even though the
  -- review row already exists.
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE id = p_transaction_id AND order_id = p_order_id
      AND merchant_id = p_merchant_id AND transaction_type = 'payment'
      AND gateway = p_gateway
  ) THEN
    RETURN false;
  END IF;

  SELECT id INTO v_review_id FROM public.reconciliation_review
    WHERE issue_type = 'duplicate_payment_capture_requires_review'
      AND order_id = p_order_id AND merchant_id = p_merchant_id
      AND resolved_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.reconciliation_review
    SET metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{captured_attempts}',
      coalesce(metadata->'captured_attempts', '{}'::jsonb) ||
        jsonb_build_object(
          p_transaction_id::text,
          jsonb_build_object(
            'gateway_reference', left(p_gateway_reference, 120),
            'gateway', left(p_gateway, 40),
            'charge_id', left(p_charge_id, 120),
            'provider_amount', p_provider_amount,
            'provider_currency', left(p_provider_currency, 12),
            'provider_status', left(p_provider_status, 60),
            'reason', left(p_reason, 120),
            'observed_at', now()
          )
        ),
      true
    )
    WHERE id = v_review_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_duplicate_payment_capture_evidence_v1(uuid,uuid,uuid,text,text,text,text,numeric,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_payment_capture_evidence_v1(uuid,uuid,uuid,text,text,text,text,numeric,text,text)
  TO service_role;
