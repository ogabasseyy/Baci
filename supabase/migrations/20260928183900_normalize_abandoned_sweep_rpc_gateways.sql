-- Normalize gateway guards in the abandoned-sweep write RPCs. The
-- sweep now selects legacy attempts whose gateway is padded or
-- re-cased (` Paystack `), but the stamp and merge RPCs still required
-- an exact `gateway = 'paystack'`: the stamp returned false so the
-- filer reported failure and the sweep retried the row forever, and
-- the merges returned false so same-order evidence refilled ref-less
-- reviews instead of merging. The id filters already bind the rows;
-- the gateway checks now normalize exactly like the aggregate
-- coverage gates (whitespace-trimmed, uppercased; missing or blank
-- gateways never match). All other behavior is unchanged from
-- 20260927151200_stamp_abandoned_sweep_resolution.sql,
-- 20260927151100_merge_abandoned_attempt_evidence_mismatch.sql, and
-- 20260927150900_merge_duplicate_payment_capture_evidence.sql.

CREATE OR REPLACE FUNCTION public.stamp_abandoned_sweep_resolution_v1(
  p_transaction_id uuid,
  p_expected_reference text,
  p_resolution text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.transactions%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_transaction_id IS NULL
    OR nullif(btrim(coalesce(p_expected_reference, '')), '') IS NULL
    OR nullif(btrim(coalesce(p_resolution, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.transactions
  SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'abandoned_sweep_resolution', p_resolution,
      'abandoned_sweep_resolved_at', now()
    ),
    updated_at = now()
  WHERE id = p_transaction_id
    AND transaction_type = 'payment'
    -- Normalize like the aggregate coverage gate: a legacy `Paystack`
    -- attempt the sweep selected must stamp instead of retrying
    -- forever. Missing or blank gateways never match.
    AND NULLIF(
      upper(
        regexp_replace(
          COALESCE(gateway, ''),
          '^\s+|\s+$',
          '',
          'g'
        )
      ),
      ''
    ) = 'PAYSTACK'
    AND gateway_reference = p_expected_reference
    AND status IN ('pending', 'processing')
    AND metadata->>'abandoned_sweep_resolution' IS NULL;
  IF FOUND THEN RETURN true; END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN RETURN true; END IF;
  IF v_row.metadata->>'abandoned_sweep_resolution' IS NOT NULL THEN
    RETURN true;
  END IF;
  IF v_row.status NOT IN ('pending', 'processing') THEN RETURN true; END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_abandoned_attempt_evidence_mismatch_v1(
  p_order_id uuid,
  p_merchant_id uuid,
  p_transaction_id uuid,
  p_gateway_reference text,
  p_reason text
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
    OR nullif(btrim(p_reason), '') IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE id = p_transaction_id AND order_id = p_order_id
      AND merchant_id = p_merchant_id AND transaction_type = 'payment'
      -- Normalize like the aggregate coverage gate: same-order
      -- evidence from a legacy `Paystack` attempt must merge instead
      -- of refiling ref-less. Missing or blank gateways never match.
      AND NULLIF(
        upper(
          regexp_replace(
            COALESCE(gateway, ''),
            '^\s+|\s+$',
            '',
            'g'
          )
        ),
        ''
      ) = 'PAYSTACK'
  ) THEN
    RETURN false;
  END IF;

  SELECT id INTO v_review_id FROM public.reconciliation_review
    WHERE issue_type = 'abandoned_attempt_evidence_mismatch'
      AND order_id = p_order_id AND merchant_id = p_merchant_id
      AND resolved_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.reconciliation_review
    SET metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{mismatched_attempts}',
      coalesce(metadata->'mismatched_attempts', '{}'::jsonb) ||
        jsonb_build_object(
          p_transaction_id::text,
          jsonb_build_object(
            'gateway_reference', left(p_gateway_reference, 120),
            'reason', left(p_reason, 200),
            'observed_at', now()
          )
        ),
      true
    )
    WHERE id = v_review_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_duplicate_payment_capture_evidence_v1(
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
  -- review row already exists. Normalize both sides like the aggregate
  -- coverage gate so a legacy `Paystack` attempt merges with the
  -- caller's `paystack` evidence.
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE id = p_transaction_id AND order_id = p_order_id
      AND merchant_id = p_merchant_id AND transaction_type = 'payment'
      AND NULLIF(
        upper(
          regexp_replace(
            COALESCE(gateway, ''),
            '^\s+|\s+$',
            '',
            'g'
          )
        ),
        ''
      ) = NULLIF(
        upper(
          regexp_replace(
            COALESCE(p_gateway, ''),
            '^\s+|\s+$',
            '',
            'g'
          )
        ),
        ''
      )
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
