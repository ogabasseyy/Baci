-- Internal refund step for GIG-reported cancellations of merchant-wallet
-- GIGL bookings (design in 20261102053300). No API grant: it is reached only
-- from apply_gigl_tracking_result (service_role-only, monitor lease
-- required), which 20261102053320 patches to pass this apply call's
-- p_events. Every check that fails refunds nothing, so the unchanged guard
-- keeps raising 55P03 'active_merchant_shipping_charge' for manual handling.
CREATE FUNCTION private.refund_gigl_wallet_charge_on_provider_cancellation(
  p_shipment_id uuid,
  p_tracking_epoch_id uuid,
  p_order_id uuid,
  p_prior_shipment_status text,
  p_events jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  -- GIG clock tolerance, and how long a submission stays in flight (the
  -- staleness window reserve/refund use for provider_submitting charges).
  v_clock_skew constant interval := interval '5 minutes';
  v_submission_window constant interval := interval '15 minutes';
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_created_at timestamptz;
  v_event_key text;
  v_raw_status text;
  v_occurred_at timestamptz;
  v_wallet_id uuid;
  v_balance numeric;
  v_transaction uuid;
  v_rows integer;
  v_refunded integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'gigl_provider_cancellation_refund_requires_tracking_apply'
      USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL THEN
    RETURN 0; -- orderless repair pickup: no merchant-wallet charge exists
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.shipment_tracking_monitors AS monitor
    WHERE monitor.shipment_id = p_shipment_id
      AND monitor.tracking_epoch_id = p_tracking_epoch_id
      AND monitor.order_id = p_order_id
      AND monitor.locked_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'gigl_provider_cancellation_refund_requires_monitor_lease'
      USING ERRCODE = '42501';
  END IF;
  -- Only cancellations before pickup are refunded automatically. The stored
  -- status can be stale or merchant-written, so the loop below also requires
  -- GIG's events to show no pickup.
  IF p_prior_shipment_status IS NULL
     OR p_prior_shipment_status NOT IN ('pending', 'booked', 'pickup_scheduled') THEN
    RETURN 0;
  END IF;
  -- The tracking worker marks GIG's cancellation events "account_attested":
  -- true only when GIG's /get/preshipment record for the claimed waybill
  -- names Baci's own GIG account (CustomerCode = the login's
  -- UserChannelCode), so a decoy waybill from a merchant's own GIG account
  -- is never attested. A Baci-account waybill booked for another order is
  -- excluded by the stamp instead: only the server's own complete() on its
  -- untouched shipment row stamps a waybill (20261102053300). Only a JSON
  -- true sent in this apply call counts.
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_events) AS attested(entry)
    WHERE attested.entry ->> 'normalized_status' = 'cancelled'
      AND attested.entry -> 'account_attested' = 'true'::jsonb
  ) THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.shipment_id = p_shipment_id
      AND charge.order_id = p_order_id
      AND charge.status = 'booked'
  ) THEN
    RETURN 0; -- customer-checkout GIG, already refunded, or a re-apply
  END IF;

  -- Same lock order as reserve_merchant_shipping_charge:
  -- advisory -> order -> charge -> wallet.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id, 0)
  );
  PERFORM 1 FROM public.orders AS o WHERE o.id = p_order_id FOR UPDATE;

  FOR v_charge IN
    SELECT charge.*
    FROM public.merchant_shipping_charges AS charge
    JOIN public.shipments AS shipment
      ON shipment.id = charge.shipment_id
     AND shipment.merchant_id = charge.merchant_id
     AND shipment.order_id = charge.order_id
     AND shipment.provider = 'GIGL'
    WHERE charge.shipment_id = p_shipment_id
      AND charge.order_id = p_order_id
      AND charge.status = 'booked'
      AND charge.provider_reference IS NOT NULL
    ORDER BY charge.id
    FOR UPDATE OF charge
  LOOP
    -- Events from earlier epochs and from this apply call count as GIG's
    -- recorded timeline.
    CONTINUE WHEN v_charge.provider_submitting_at IS NULL;
    -- (a) GIG created the stamped waybill while this charge's submission was
    --     in flight; keep the latest such creation scan.
    SELECT max(created.occurred_at)
    INTO v_created_at
    FROM public.shipment_tracking_events AS created
    WHERE created.shipment_id = p_shipment_id
      AND created.provider = 'GIGL'
      AND created.tracking_number = v_charge.provider_reference
      AND created.normalized_status = 'booked'
      AND created.occurred_at
        >= v_charge.provider_submitting_at - v_clock_skew
      AND created.occurred_at
        <= v_charge.provider_submitting_at + v_submission_window;
    CONTINUE WHEN v_created_at IS NULL;
    -- (b) Nothing GIG reported for that waybill predates the submission (a
    --     reused or older waybill), and (c) nothing shows a pickup or later
    --     scan. The normalizer stores every scan code it does not recognize
    --     as 'pending' (production: ARF, arrived at final destination), so a
    --     'pending' event counts as pre-pickup only when GIG's raw status
    --     really is PENDING.
    CONTINUE WHEN EXISTS (
      SELECT 1
      FROM public.shipment_tracking_events AS history
      WHERE history.shipment_id = p_shipment_id
        AND history.provider = 'GIGL'
        AND history.tracking_number = v_charge.provider_reference
        AND (
          history.occurred_at < v_charge.provider_submitting_at - v_clock_skew
          OR history.normalized_status NOT IN (
            'pending', 'booked', 'pickup_scheduled', 'cancelled'
          )
          OR (
            history.normalized_status = 'pending'
            AND upper(btrim(coalesce(history.raw_status, ''))) <> 'PENDING'
          )
        )
    );
    -- (d) This worker epoch recorded GIG's cancellation of that waybill no
    --     earlier than the creation scan, and this apply call attests that
    --     very event.
    SELECT event.provider_event_key, event.raw_status, event.occurred_at
    INTO v_event_key, v_raw_status, v_occurred_at
    FROM public.shipment_tracking_events AS event
    WHERE event.shipment_id = p_shipment_id
      AND event.tracking_epoch_id = p_tracking_epoch_id
      AND event.provider = 'GIGL'
      AND event.normalized_status = 'cancelled'
      AND event.tracking_number = v_charge.provider_reference
      AND event.occurred_at >= v_created_at
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_events) AS attested(entry)
        WHERE attested.entry ->> 'provider_event_key' = event.provider_event_key
          AND attested.entry ->> 'normalized_status' = 'cancelled'
          AND attested.entry -> 'account_attested' = 'true'::jsonb
      )
    ORDER BY event.occurred_at DESC, event.id
    LIMIT 1;
    CONTINUE WHEN NOT FOUND;

    -- Refund exactly what was debited. A mismatched debit or a missing
    -- wallet declines the refund, so the guard raises its documented 55P03
    -- for manual handling instead of an opaque error wedging the apply.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1
      FROM public.wallet_transactions AS debit
      WHERE debit.id = v_charge.debit_transaction_id
        AND debit.merchant_id = v_charge.merchant_id
        AND debit.type = 'debit'
        AND debit.status = 'completed'
        AND debit.source_type = 'gigl_shipping'
        AND debit.source_id = v_charge.order_id
        AND debit.amount = v_charge.charged_amount
    );

    UPDATE public.merchant_wallets AS wallet
    SET available_balance = wallet.available_balance + v_charge.charged_amount,
        updated_at = now()
    WHERE wallet.merchant_id = v_charge.merchant_id
    RETURNING wallet.id, wallet.available_balance INTO v_wallet_id, v_balance;
    CONTINUE WHEN NOT FOUND;

    INSERT INTO public.wallet_transactions (
      wallet_id, merchant_id, type, amount, balance_after, source_type,
      source_id, description, status, metadata
    ) VALUES (
      v_wallet_id, v_charge.merchant_id, 'refund', v_charge.charged_amount,
      v_balance, 'gigl_shipping', v_charge.order_id,
      'GIGL shipping refund: shipment cancelled by GIG', 'completed',
      jsonb_build_object(
        'reason_code', 'PROVIDER_CANCELLED_AFTER_BOOKING',
        'merchant_shipping_charge_id', v_charge.id,
        'shipment_id', p_shipment_id,
        'waybill', v_charge.provider_reference,
        'tracking_epoch_id', p_tracking_epoch_id,
        'provider_event_key', v_event_key,
        'provider_raw_status', v_raw_status,
        'provider_event_occurred_at', v_occurred_at,
        'provider_created_at', v_created_at,
        'provider_account_attested', true,
        'prior_shipment_status', p_prior_shipment_status,
        'provider_cost', v_charge.provider_cost,
        'platform_margin', v_charge.platform_margin
      )
    )
    RETURNING id INTO v_transaction;

    UPDATE public.merchant_shipping_charges AS charge
    SET status = 'refunded',
        refund_transaction_id = v_transaction,
        failure_code = 'PROVIDER_CANCELLED_AFTER_BOOKING',
        refunded_at = now(),
        updated_at = now()
    WHERE charge.id = v_charge.id
      AND charge.status = 'booked';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'gigl_wallet_charge_refund_race' USING ERRCODE = '40001';
    END IF;
    v_refunded := v_refunded + 1;
  END LOOP;
  RETURN v_refunded;
END;
$$;
REVOKE ALL ON FUNCTION private.refund_gigl_wallet_charge_on_provider_cancellation(uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
