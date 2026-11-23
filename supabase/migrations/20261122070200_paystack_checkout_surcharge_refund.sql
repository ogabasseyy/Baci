-- A certified surcharge is part of the Paystack charge, not the order
-- principal. Refund that charge only as one full native Paystack refund.
CREATE FUNCTION private.paystack_refund_capture_gross_minor(p_payment public.transactions)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_customer_fee numeric;
  v_gross numeric;
  v_principal numeric := p_payment.amount * 100;
BEGIN
  IF NOT COALESCE(p_payment.gateway_response ? 'baci_paystack_checkout_customer_fee_minor', false) THEN
    RETURN round(v_principal)::bigint;
  END IF;
  IF public.normalized_gateway_name_v1(p_payment.gateway) IS DISTINCT FROM 'PAYSTACK'
    OR p_payment.currency IS DISTINCT FROM 'NGN'
    OR jsonb_typeof(p_payment.gateway_response->'baci_paystack_checkout_customer_fee_minor') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payment.gateway_response->'amount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payment.gateway_response->'requested_amount') IS DISTINCT FROM 'number' THEN
    RETURN NULL;
  END IF;

  v_customer_fee := (p_payment.gateway_response->>'baci_paystack_checkout_customer_fee_minor')::numeric;
  v_gross := (p_payment.gateway_response->>'amount')::numeric;
  IF v_principal IS NULL OR v_principal <= 0 OR v_principal <> trunc(v_principal)
    OR v_gross > 9007199254740991 OR v_gross <> trunc(v_gross)
    OR v_customer_fee <= 0 OR v_customer_fee <> trunc(v_customer_fee)
    OR (p_payment.gateway_response->>'requested_amount')::numeric IS DISTINCT FROM v_principal
    OR v_gross IS DISTINCT FROM v_principal + v_customer_fee THEN
    RETURN NULL;
  END IF;
  RETURN v_gross::bigint;
END;
$$;
REVOKE ALL ON FUNCTION private.paystack_refund_capture_gross_minor(public.transactions)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.paystack_cancellation_refund_provider_minor(
  p_refund public.transactions, p_payment public.transactions
) RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_gross bigint := private.paystack_refund_capture_gross_minor(p_payment);
BEGIN
  IF NOT COALESCE(p_payment.gateway_response ? 'baci_paystack_checkout_customer_fee_minor', false) THEN
    IF p_refund.metadata ? 'provider_refund_amount_minor' THEN RETURN NULL; END IF;
    RETURN round(p_refund.amount * 100)::bigint;
  END IF;

  IF v_gross IS NULL
    OR public.normalized_gateway_name_v1(p_refund.gateway) IS DISTINCT FROM 'PAYSTACK'
    OR upper(btrim(p_refund.currency)) IS DISTINCT FROM 'NGN'
    OR p_refund.amount IS DISTINCT FROM p_payment.amount
    OR p_refund.metadata->>'payment_transaction_id' IS DISTINCT FROM p_payment.id::text
    OR jsonb_typeof(p_refund.metadata->'provider_refund_amount_minor') IS DISTINCT FROM 'number'
    OR COALESCE(p_refund.gateway_reference,'') !~ '^[1-9][0-9]{0,19}$' THEN
    RETURN NULL;
  END IF;
  IF (p_refund.metadata->>'provider_refund_amount_minor')::numeric IS DISTINCT FROM v_gross::numeric THEN
    RETURN NULL;
  END IF;
  RETURN v_gross;
END;
$$;
REVOKE ALL ON FUNCTION private.paystack_cancellation_refund_provider_minor(public.transactions,public.transactions)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.enforce_paystack_checkout_surcharge_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payment public.transactions%ROWTYPE;
  v_ids uuid[];
BEGIN
  IF NEW.transaction_type <> 'refund' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.order_id,NEW.merchant_id,NEW.gateway,NEW.amount,NEW.currency,NEW.gateway_reference,
      NEW.metadata->'provider_refund_amount_minor',NEW.metadata->'payment_transaction_id')
    IS NOT DISTINCT FROM ROW(OLD.order_id,OLD.merchant_id,OLD.gateway,OLD.amount,OLD.currency,OLD.gateway_reference,
      OLD.metadata->'provider_refund_amount_minor',OLD.metadata->'payment_transaction_id')
    AND NOT (OLD.status = 'failed' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(t.id) INTO v_ids FROM public.transactions t
  WHERE t.order_id = NEW.order_id AND t.merchant_id = NEW.merchant_id
    AND t.transaction_type = 'payment' AND t.status = 'completed'
    AND t.gateway_response ? 'baci_paystack_checkout_customer_fee_minor';
  IF v_ids IS NULL AND NOT COALESCE(NEW.metadata ? 'provider_refund_amount_minor',false) THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.orders o WHERE o.id = NEW.order_id AND o.merchant_id = NEW.merchant_id FOR UPDATE;
  SELECT t.* INTO v_payment FROM public.transactions t
  WHERE t.id::text = NEW.metadata->>'payment_transaction_id'
    AND t.order_id = NEW.order_id AND t.merchant_id = NEW.merchant_id
    AND t.transaction_type = 'payment' AND t.status = 'completed';
  IF NOT FOUND OR private.paystack_cancellation_refund_provider_minor(NEW,v_payment) IS NULL THEN
    RAISE EXCEPTION 'refund_evidence_mismatch';
  END IF;
  IF v_payment.id = ANY(v_ids) AND NEW.status <> 'failed' AND EXISTS (
    SELECT 1 FROM public.transactions r
    WHERE r.order_id = NEW.order_id AND r.merchant_id = NEW.merchant_id
      AND r.transaction_type = 'refund' AND r.id IS DISTINCT FROM NEW.id
      AND r.gateway_reference IS DISTINCT FROM NEW.gateway_reference
      AND (r.metadata->>'payment_transaction_id' IS NULL
        OR r.metadata->>'payment_transaction_id' = v_payment.id::text)
      AND (r.status IS DISTINCT FROM 'failed'
        OR r.metadata->>'provider_refund_status' IS DISTINCT FROM 'failed')
  ) THEN
    RAISE EXCEPTION 'refund_evidence_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_paystack_checkout_surcharge_refund() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_paystack_checkout_surcharge_refund
  BEFORE INSERT OR UPDATE OF amount,currency,merchant_id,order_id,gateway,gateway_reference,status,metadata ON public.transactions
  FOR EACH ROW WHEN (NEW.transaction_type = 'refund')
  EXECUTE FUNCTION private.enforce_paystack_checkout_surcharge_refund();

CREATE OR REPLACE FUNCTION public.record_verified_paystack_cancellation_refund_v1(
  p_refund_id uuid,
  p_provider_status text,
  p_provider_transaction_id numeric,
  p_amount_kobo bigint,
  p_currency text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_refund public.transactions%ROWTYPE;
  v_payment public.transactions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_order_id uuid;
  v_external_payments integer;
  v_status text := lower(btrim(coalesce(p_provider_status, '')));
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('pending', 'processing', 'needs-attention', 'failed', 'processed')
    OR p_provider_transaction_id IS NULL OR p_amount_kobo IS NULL
    OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'invalid_refund_evidence';
  END IF;

  -- Order id first, unlocked: the order lock below must precede the
  -- refund-row lock, and only the row knows its order. The row
  -- predicate still evaluates under its own FOR UPDATE, so a
  -- concurrent metadata change cannot slip an unqualified row in.
  SELECT order_id INTO v_order_id FROM public.transactions
    WHERE id = p_refund_id AND transaction_type = 'refund';
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND
    OR v_order.cancelled_at IS NULL OR v_order.shipping_status NOT IN ('cancelled', 'canceled') THEN
    RAISE EXCEPTION 'refund_order_mismatch';
  END IF;

  SELECT * INTO v_refund FROM public.transactions
    WHERE id = p_refund_id AND transaction_type = 'refund'
      -- Legacy cancellation refunds may store `Paystack` or padding;
      -- the id filter already binds the row, so normalize instead of
      -- an exact match that would hold verified refunds out of polling.
      -- Stamped manuals (numeric stored provider id, mirroring the
      -- sweep predicate) verify like provider rows whatever the last
      -- verdict was: the payment linkage, amount, and currency checks
      -- below bind the row to its Paystack capture unchanged.
      AND (public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
        AND gateway_reference ~ '^[0-9]+$'
        OR (public.normalized_gateway_name_v1(gateway) = 'MANUAL'
          AND metadata->>'provider_refund_id' ~ '^[0-9]+$')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF v_order.merchant_id <> v_refund.merchant_id THEN
    RAISE EXCEPTION 'refund_order_mismatch';
  END IF;
  -- A malformed link must terminalize as evidence mismatch, not raise
  -- raw 22P02: the workers classify mismatch as deterministic review
  -- evidence, while an invalid-cast error looks retryable and the row
  -- rotates forever. Gate the cast on the canonical UUID shape the
  -- TypeScript reconciler mirrors; a non-match finds no payment and
  -- falls into the mismatch raise below.
  SELECT * INTO v_payment FROM public.transactions
    WHERE id = CASE WHEN coalesce(v_refund.metadata->>'payment_transaction_id','')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (v_refund.metadata->>'payment_transaction_id')::uuid END
      AND order_id = v_order.id AND merchant_id = v_order.merchant_id
      AND transaction_type = 'payment'
      -- Normalize like the aggregate coverage gate: a legacy `Paystack`
      -- leg and its `paystack` refund must verify together. Missing or
      -- blank gateways never match.
      AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
      AND status = 'completed';
  IF NOT FOUND AND v_refund.metadata->>'payment_transaction_id' IS NULL THEN
    -- Legacy refunds carry no payment link. Mirror the cancellation claim
    -- rule: accept the order's sole completed external payment when it
    -- shares the refund's gateway and covers its amount. Partial refunds
    -- verify against their own row amount; the completion gate below sums
    -- them per leg.
    SELECT count(*) INTO v_external_payments FROM public.transactions
      WHERE order_id = v_order.id AND merchant_id = v_order.merchant_id
        AND transaction_type = 'payment' AND status = 'completed'
        AND amount > 0
        AND coalesce(public.normalized_gateway_name_v1(gateway), '') NOT IN
          ('WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY');
    IF v_external_payments = 1 THEN
      -- Normalize gateways like the aggregate coverage gate: a legacy
      -- `Paystack` leg and its `paystack` refund must verify together.
      SELECT * INTO v_payment FROM public.transactions
        WHERE order_id = v_order.id AND merchant_id = v_order.merchant_id
          AND transaction_type = 'payment' AND status = 'completed'
          AND amount > 0
          AND public.normalized_gateway_name_v1(gateway) = public.normalized_gateway_name_v1(v_refund.gateway)
          AND amount >= v_refund.amount;
    END IF;
  END IF;
  IF NOT FOUND OR v_payment.gateway_reference IS NULL
    OR v_refund.amount > v_payment.amount
    OR upper(btrim(v_refund.currency)) <> upper(btrim(p_currency))
    OR private.paystack_cancellation_refund_provider_minor(v_refund,v_payment) IS DISTINCT FROM p_amount_kobo
    OR (v_refund.metadata ? 'provider_payment_transaction_id' AND
        CASE WHEN coalesce(v_refund.metadata->>'provider_payment_transaction_id', '') ~ '^[0-9]+$'
                    AND length(v_refund.metadata->>'provider_payment_transaction_id') <= 20
          THEN (v_refund.metadata->>'provider_payment_transaction_id')::numeric
                 IS DISTINCT FROM p_provider_transaction_id
          ELSE true END) THEN
    RAISE EXCEPTION 'refund_evidence_mismatch';
  END IF;

  -- A locally completed row with a contradictory provider verdict falls
  -- through: persist the provider status, notify, and rotate updated_at below.
  -- Nonterminal verdicts (pending/processing/needs-attention) keep a
  -- completed row completed so the legacy recheck keeps verifying it:
  -- demoting to refund_pending would strand legacy rows that lack the
  -- cancellation description the pending worker requires, leaving them
  -- selected by neither worker.
  IF v_refund.status = 'failed' AND v_status <> 'processed' THEN
    -- Legacy failed rows predate the notification table, and the
    -- periodic refund workers exclude failed rows: without this insert
    -- the first verified failure verdict is acknowledged without ever
    -- notifying the merchant. Queued rows already guarantee a covering
    -- alert, and settled rows prove the merchant was notified, so the
    -- conflict does nothing and repeat verdicts never re-alert.
    INSERT INTO public.paystack_cancellation_refund_notifications
      (order_id, merchant_id, event_type)
    VALUES (v_order.id, v_order.merchant_id, 'failed_merchant_push')
    ON CONFLICT (order_id, event_type) DO NOTHING;
    -- Round-61 P1: persist the repeat verdict as the row's provider
    -- stamp before returning. The gates treat an unstamped failed
    -- row as live (processed can still resurrect it); without this
    -- write a confirming verdict would never clear them.
    UPDATE public.transactions SET
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('provider_refund_status', v_status),
      updated_at = now()
    WHERE id = v_refund.id;
    RETURN 'already_failed';
  END IF;
  -- A repeat verdict is a no-op only when this leg already reflects
  -- it and the order's failure alert is durable. Legacy rows stored
  -- the verdict while staying in pending: returning early would skip
  -- the transition and the alert forever while the pending sweep
  -- reselects the row indefinitely. Failed rows return above, so a
  -- failed verdict here always needs its transition — except on a
  -- terminal completed row whose contradiction is already surfaced.
  -- Needs-attention settles at refund_pending. Still rotate the row
  -- so reviewed rows cannot pin the workers' oldest-25 batch.
  IF v_status IN ('failed', 'needs-attention')
    AND v_refund.metadata->>'provider_refund_status' = v_status
    AND (
      (v_status = 'failed' AND v_refund.status = 'completed')
      OR (v_status = 'needs-attention'
          AND v_refund.status IN ('refund_pending', 'completed'))
    )
    AND EXISTS (
      SELECT 1 FROM public.paystack_cancellation_refund_notifications n
      WHERE n.order_id = v_order.id
        AND n.merchant_id = v_order.merchant_id
        AND n.event_type = 'failed_merchant_push'
    ) THEN
    UPDATE public.transactions SET updated_at = now() WHERE id = v_refund.id;
    RETURN v_status;
  END IF;
  UPDATE public.transactions SET
    status = CASE WHEN v_status = 'processed' THEN 'completed'
                  WHEN v_status = 'failed' THEN 'failed'
                  WHEN v_refund.status = 'completed' THEN 'completed'
                  ELSE 'refund_pending' END,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'refund_reconciliation_hold') ||
      jsonb_build_object('provider_refund_status', v_status),
    updated_at = now()
  WHERE id = v_refund.id;

  IF v_status IN ('failed', 'needs-attention') THEN
    -- A failure arriving during an active claim must not be lost when
    -- the worker concludes on older evidence: bump the generation (the
    -- claim itself is never clobbered) so the worker's finish detects
    -- the fresh contradiction and requeues it for the next sweep. Runs
    -- before the reset below so a recycled row keeps generation 0.
    UPDATE public.paystack_cancellation_refund_notifications
    SET generation = generation + 1
    WHERE order_id = v_order.id
      AND merchant_id = v_order.merchant_id
      AND event_type = 'failed_merchant_push'
      AND status IN ('pending', 'processing');
    -- A later failure on another leg (or a contradictory failure after
    -- the order became refunded) must re-alert: reset a settled row to
    -- claimable. Queued rows already guarantee a covering alert.
    INSERT INTO public.paystack_cancellation_refund_notifications
      (order_id, merchant_id, event_type)
    VALUES (v_order.id, v_order.merchant_id, 'failed_merchant_push')
    ON CONFLICT (order_id, event_type) DO UPDATE SET
      status = 'pending',
      attempts = 0,
      claimed_at = NULL,
      claim_token = NULL,
      last_error = NULL,
      sent_at = NULL,
      created_at = now(),
      generation = 0
    WHERE paystack_cancellation_refund_notifications.status IN
      ('sent', 'failed', 'delivery_uncertain');
    RETURN v_status;
  END IF;
  IF v_status <> 'processed' THEN RETURN v_status; END IF;

  -- Same-gateway terminal scan plus the shared legs-covered
  -- gate for manual-covered legs (see the predicate helper).
  IF private.reconciliation_should_finalize_v1(
    v_order.id, v_order.merchant_id, v_order.currency, v_order.payment_status
  ) THEN
    -- Every funded leg has terminal refund evidence: run the shared
    -- aggregate finalization (order transition, settlement reversal,
    -- notifications, review close).
    PERFORM public.finalize_refunded_cancellation_order_v1(
      v_order.id, v_order.merchant_id, v_refund.id
    );
    -- Reconciliation finalized the money: a delivery-uncertain side
    -- effect would otherwise report requires_review (and stop panel
    -- polling) forever despite complete coverage. Complete it once
    -- no review still needs a human.
    UPDATE public.order_cancellation_side_effects
       SET status = 'completed',
           completed_at = COALESCE(completed_at, now()),
           error = NULL
     WHERE order_id = v_order.id AND step = 'refund'
       AND status = 'delivery_uncertain'
       AND NOT EXISTS (
         SELECT 1 FROM public.reconciliation_review rr
          WHERE rr.order_id = v_order.id
            AND (rr.merchant_id = v_order.merchant_id OR rr.merchant_id IS NULL)
            AND rr.resolved_at IS NULL);
  END IF;
  RETURN 'processed';
END;
$$;
REVOKE ALL ON FUNCTION public.record_verified_paystack_cancellation_refund_v1(uuid,text,numeric,bigint,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_paystack_cancellation_refund_v1(uuid,text,numeric,bigint,text)
  TO service_role;

-- Include only the money proof fields in recovery candidates.
CREATE OR REPLACE FUNCTION public.open_paystack_refund_recovery_watch_v1(
  p_paystack_ref text,
  p_provider_refund_id bigint,
  p_evidence jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reference text;
  v_matches jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  v_reference := nullif(btrim(coalesce(p_paystack_ref, '')), '');
  IF v_reference IS NULL OR p_provider_refund_id IS NULL
    OR p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
    RAISE EXCEPTION 'invalid_refund_recovery_watch' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'baci_paystack_refund_watch:' || v_reference, 0)
  );

  BEGIN
    INSERT INTO public.paystack_refund_recovery_watch (
      paystack_ref, provider_refund_id, evidence
    ) VALUES (v_reference, p_provider_refund_id, p_evidence);
  EXCEPTION WHEN unique_violation THEN
    -- A prior scan (or redelivery) already watches this refund:
    -- refresh the evidence and re-scan under the lock. The refresh
    -- is verdict-sticky: a delayed failed observation must not
    -- overwrite an earlier processed one, or the claim would file
    -- failed-only evidence and audit blocking would unblock a leg a
    -- processed refund was observed for. Mirrors the leg-merge
    -- truth table (trimmed, case-insensitive failed spelling).
    UPDATE public.paystack_refund_recovery_watch
      SET evidence = CASE
        WHEN evidence->>'provider_refund_status' IS NOT NULL
          AND lower(btrim(evidence->>'provider_refund_status')) <> 'failed'
          AND (
            p_evidence->>'provider_refund_status' IS NULL
            OR lower(btrim(p_evidence->>'provider_refund_status')) = 'failed'
          )
        THEN evidence ELSE p_evidence END,
        updated_at = now()
      WHERE paystack_ref = v_reference
        AND provider_refund_id = p_provider_refund_id
        AND status = 'open';
  END;

  -- Mirrors fetchCompletedPaymentsByReference: every completed
  -- Paystack payment for the reference, in stable id order.
  SELECT coalesce(jsonb_agg(row ORDER BY row->>'id'), '[]'::jsonb)
    INTO v_matches
    FROM (
      SELECT jsonb_build_object(
        'id', t.id,
        'order_id', t.order_id,
        'merchant_id', t.merchant_id,
        'gateway_reference', t.gateway_reference,
        'amount', t.amount
      ) || CASE WHEN t.gateway_response ? 'baci_paystack_checkout_customer_fee_minor' THEN
        jsonb_build_object('gateway_response',jsonb_build_object(
          'amount',t.gateway_response->'amount','requested_amount',t.gateway_response->'requested_amount',
          'baci_paystack_checkout_customer_fee_minor',t.gateway_response->'baci_paystack_checkout_customer_fee_minor'))
        ELSE '{}'::jsonb END AS row
      FROM public.transactions AS t
      WHERE public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
        AND t.gateway_reference = v_reference
        AND t.transaction_type = 'payment'
        AND t.status = 'completed'
    ) AS matches;
  RETURN v_matches;
END;
$$;
REVOKE ALL ON FUNCTION public.open_paystack_refund_recovery_watch_v1(text,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_paystack_refund_recovery_watch_v1(text,bigint,jsonb)
  TO service_role;
