-- Manager RPC (4/5): private.manage_order_refund owns auth, coverage
-- math, and the retry path; the manual-record branch and the response
-- shape live in the part-3 helpers (3a record, 3b response). The
-- public delegate and the status trigger follow in part 5.

-- The confirmation and leg-pin parameters change the signature:
-- without DROPs the older overloads would survive beside the new
-- one, leaving unattested entry points behind (and the 1-argument
-- status call would stop resolving uniquely).
DROP FUNCTION IF EXISTS private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text);
DROP FUNCTION IF EXISTS private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean);
CREATE OR REPLACE FUNCTION private.manage_order_refund(
  p_order_id uuid, p_action text DEFAULT 'status', p_amount numeric DEFAULT NULL,
  p_refunded_at timestamptz DEFAULT NULL, p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL, p_note text DEFAULT NULL,
  p_confirmed boolean DEFAULT NULL, p_payment_transaction_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order record;
  v_step_status text;
  v_step_error text;
  v_step_attempts integer;
  v_step_retry_requests integer;
  v_manual jsonb;
  v_manual_partial boolean;
  v_payment_refunded numeric;
  v_payment_pending numeric;
  v_refunded numeric;
  v_pending numeric;
  v_remaining numeric;
  v_reversed_internal numeric;
  v_can_manage boolean;
  v_reference text;
  v_sole_external_leg boolean;
  v_sole_leg_gateway text;
  v_replay jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF p_action NOT IN ('status','retry','manual') THEN
    RAISE EXCEPTION 'invalid_refund_action' USING ERRCODE='22023';
  END IF;
  SELECT merchant_id,currency,amount_paid,shipping_status,cancelled_at INTO v_order
    FROM public.orders WHERE id=p_order_id FOR UPDATE;
  -- Missing and foreign orders share one error: distinct not-found vs
  -- forbidden responses would let any authenticated caller probe order
  -- existence across tenants.
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_forbidden' USING ERRCODE='42501'; END IF;
  -- Legacy orders may carry a null or blank currency while their
  -- payment legs price in NGN: normalize to the established default
  -- before any comparison, or every manual attempt spuriously raises
  -- payment_currency_requires_review. Mirrors the dashboard fallback.
  v_order.currency := COALESCE(NULLIF(BTRIM(v_order.currency), ''), 'NGN');
  v_can_manage := EXISTS (SELECT 1 FROM public.merchants WHERE id=v_order.merchant_id AND user_id=v_actor)
    OR public.check_staff_permission(v_actor,v_order.merchant_id,'orders','refund');
  IF NOT (v_can_manage OR (p_action='status'
    AND public.check_staff_permission(v_actor,v_order.merchant_id,'orders','view'))) THEN
    RAISE EXCEPTION 'refund_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT status,error,attempts,retry_requests INTO v_step_status,v_step_error,v_step_attempts,v_step_retry_requests
    FROM public.order_cancellation_side_effects
    WHERE order_id=p_order_id AND step='refund' FOR UPDATE;
  -- Coverage counts matching money only: a foreign-currency row is an
  -- anomaly for review, and subtracting it would let the merchant
  -- record less than is owed while the order flips refunded.
  -- A locally completed Paystack row counts as returned only after
  -- provider verification (metadata provider_refund_status =
  -- 'processed'), mirroring the claim gate and the executor
  -- matcher: counting an unverified row would understate the
  -- remainder while aggregate finalization keeps deferring.
  -- The same holds for a manual row declared as Paystack
  -- (metadata method = 'paystack'): a merchant claim about
  -- provider money, verified or pending but never coverage.
  -- Unverified rows are in-flight money that blocks manual
  -- recording (like refund_pending legs) — never invisible money
  -- the merchant could double-record beside the provider refund.
  -- Refunds attribute to their linked leg under the claim's
  -- normalized-gateway rules, with the explicit manual-row exception
  -- (a merchant transfer covers any leg it is allocated to):
  -- counting a cross-gateway row would zero the balance and flip
  -- the label while the claim rejects the evidence and the worker
  -- quarantines, with recovery gates then blocking every manual
  -- retry. Unlinked rows attribute only to a sole completed
  -- external leg with a matching gateway (manual rows never
  -- sole-attribute — the sole leg is external by construction).
  -- Unattributable rows wait in pending instead.
  SELECT count(*)=1,
    max(public.normalized_gateway_name_v1(sole.gateway))
    INTO v_sole_external_leg,v_sole_leg_gateway FROM public.transactions sole
    WHERE sole.order_id=p_order_id AND sole.merchant_id=v_order.merchant_id
    AND sole.transaction_type='payment' AND sole.status='completed' AND sole.amount>0
    AND COALESCE(public.normalized_gateway_name_v1(sole.gateway),'') NOT IN (
      'WALLET','SAVINGS','STORE_CREDIT','CASH','MANUAL','PAY_ON_DELIVERY');
  -- Terminal coverage comes capped per payment leg from the shared
  -- helper: an overfunded leg's excess must not zero the remainder
  -- while sibling legs sit uncovered. Pending stays a global sum:
  -- over-counting in-flight money only blocks actions safely.
  -- Nonmatching-currency rows (null or foreign) stay out of
  -- coverage but count as pending: the manager cannot convert
  -- money, so an unexplained linked row must block recording
  -- until reconciliation instead of leaving the full balance
  -- recordable beside it (double-record). The outer WHERE keeps
  -- only the link-validated predicate for this reason: currency
  -- filtering here would drop the row from both sums.
  SELECT private.capped_refund_coverage_v1(
      p_order_id, v_order.merchant_id, v_order.currency),
    COALESCE(sum(amount) FILTER (WHERE status NOT IN ('completed','refunded','failed')
      OR (status IN ('completed','refunded')
        AND (public.normalized_gateway_name_v1(gateway) IS NOT DISTINCT FROM 'PAYSTACK'
          OR (public.normalized_gateway_name_v1(gateway)='MANUAL'
            AND metadata->>'method'='paystack'))
        AND metadata->>'provider_refund_status' IS DISTINCT FROM 'processed')
      OR (status IN ('completed','refunded')
        AND upper(btrim(currency)) IS DISTINCT FROM upper(btrim(
          COALESCE(NULLIF(BTRIM(v_order.currency),''),'NGN'))))
      OR (status IN ('completed','refunded')
        AND NOT COALESCE((EXISTS (SELECT 1 FROM public.transactions leg
            WHERE leg.id::text = transactions.metadata->>'payment_transaction_id'
              AND leg.order_id=p_order_id AND leg.merchant_id=v_order.merchant_id
              AND leg.transaction_type='payment'
              AND (public.normalized_gateway_name_v1(transactions.gateway)='MANUAL'
                OR public.normalized_gateway_name_v1(transactions.gateway)
                  =public.normalized_gateway_name_v1(leg.gateway)))
          OR (transactions.metadata->>'payment_transaction_id' IS NULL
            AND v_sole_external_leg
            AND public.normalized_gateway_name_v1(gateway)=v_sole_leg_gateway)),false))),0)
    INTO v_refunded,v_pending FROM public.transactions
    WHERE order_id=p_order_id AND merchant_id=v_order.merchant_id AND transaction_type='refund'
    -- Count only validated links: a row claiming a leg outside this
    -- order (or otherwise unresolvable) is corrupt evidence the
    -- worker quarantines, so counting it would understate the
    -- remainder while the order flips refunded. Compared as text so
    -- a malformed link excludes instead of raising.
    AND (metadata->>'payment_transaction_id' IS NULL
      OR EXISTS (SELECT 1 FROM public.transactions leg
        WHERE leg.id::text = transactions.metadata->>'payment_transaction_id'
          AND leg.order_id=p_order_id AND leg.merchant_id=v_order.merchant_id
          AND leg.transaction_type='payment'));
  -- Self-terminal payment legs (e.g. PayPal flips the payment row
  -- itself instead of inserting a refund row) count toward their side:
  -- refunded legs are returned money, refund_pending legs are
  -- in-flight money that blocks manual recording. External legs only,
  -- mirroring the aggregate claim; internal legs reverse through
  -- their own ledgers below.
  SELECT COALESCE(SUM(amount) FILTER (WHERE status='refunded'),0),
    COALESCE(SUM(amount) FILTER (WHERE status='refund_pending'),0)
    INTO v_payment_refunded,v_payment_pending FROM public.transactions
    WHERE order_id=p_order_id AND merchant_id=v_order.merchant_id
    AND transaction_type='payment' AND amount>0
    AND upper(btrim(currency))=upper(btrim(v_order.currency))
    AND COALESCE(public.normalized_gateway_name_v1(gateway),'') NOT IN (
      'WALLET','SAVINGS','STORE_CREDIT','CASH','MANUAL','PAY_ON_DELIVERY');
  v_refunded := v_refunded + v_payment_refunded;
  v_pending := v_pending + v_payment_pending;
  -- Internal redemptions return outside the refund ledger: wallet reversals
  -- credit customer_wallets and savings reversals restore the goal, so the
  -- outstanding balance excludes already-reversed internal amounts.
  SELECT COALESCE((
    SELECT sum(t.amount) FROM public.customer_wallet_transactions t
    WHERE t.source_id=p_order_id AND t.merchant_id=v_order.merchant_id
      AND t.source_type='order_reversal'),0)
    + COALESCE((
    SELECT sum(r.amount) FROM public.customer_savings_redemptions r
    WHERE r.order_id=p_order_id AND r.merchant_id=v_order.merchant_id
      AND r.metadata ? 'reversed_at'),0)
    INTO v_reversed_internal;
  v_refunded := v_refunded + v_reversed_internal;
  -- A superseded capture (a refunded obsolete leg matching
  -- amount_paid beside an outstanding one) zeroes the paid-minus-
  -- coverage remainder while the executor still owes the uncovered
  -- leg: floor at the per-leg uncovered obligation so recording
  -- stays open and the status stays honest.
  v_remaining := GREATEST(COALESCE(v_order.amount_paid,0)-v_refunded,
    private.uncovered_refund_obligation_v1(p_order_id,
      v_order.merchant_id, v_order.currency, v_reversed_internal,
      COALESCE(v_order.amount_paid,0)),0);
  -- A partial manual record mismatches the worker's gateway matcher
  -- (gateway 'manual' never covers a Paystack leg), so retrying now
  -- would quarantine the step and hide further manual actions. Once a
  -- merchant starts manual coverage, they finish the balance manually.
  SELECT EXISTS(SELECT 1 FROM public.transactions
    WHERE order_id=p_order_id AND transaction_type='refund'
    AND status IN ('completed','refunded') AND gateway='manual')
    AND v_remaining>0 INTO v_manual_partial;

  IF p_action <> 'status' THEN
    IF v_order.shipping_status NOT IN ('cancelled','canceled') OR v_order.amount_paid <= 0 THEN
      RAISE EXCEPTION 'cancelled_paid_order_required' USING ERRCODE='P0001';
    END IF;
    IF p_action='manual' THEN
      v_reference := NULLIF(btrim(p_reference),'');
      IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
        OR p_refunded_at IS NULL OR p_refunded_at>now()
        OR p_method IS NULL OR p_method NOT IN ('paystack','bank_transfer','cash','other')
        OR v_reference IS NULL OR length(v_reference)>100
        OR COALESCE(length(p_note),0)>500 THEN
        RAISE EXCEPTION 'invalid_manual_refund' USING ERRCODE='22023';
      END IF;
      SELECT jsonb_build_object('amount',sum(amount),'method',min(metadata->>'method'),
        'refunded_at',min(metadata->>'refunded_at'),'note',min(metadata->>'note')) INTO v_replay
        FROM public.transactions WHERE order_id=p_order_id AND transaction_type='refund'
        AND gateway='manual' AND metadata->>'reference'=v_reference;
      IF (v_replay->>'amount') IS NOT NULL THEN
        IF (v_replay->>'amount')::numeric<>p_amount OR v_replay->>'method'<>p_method
          OR (v_replay->>'refunded_at')::timestamptz<>p_refunded_at THEN
          RAISE EXCEPTION 'manual_reference_conflict' USING ERRCODE='P0001';
        END IF;
        -- Same transfer: money fields match, so no new money moves. A
        -- differing note is an annotation correction, not a new
        -- transfer (a new reference would double-record the money),
        -- so refresh it on every leg row instead of keeping stale
        -- audit text.
        IF COALESCE(v_replay->>'note','') IS DISTINCT FROM COALESCE(p_note,'') THEN
          UPDATE public.transactions SET metadata = metadata ||
            jsonb_build_object('note',p_note)
            WHERE order_id=p_order_id AND transaction_type='refund'
              AND gateway='manual' AND metadata->>'reference'=v_reference;
        END IF;
        p_action := 'status'; -- Idempotent retry of an already recorded transfer.
      END IF;
    END IF;
    IF p_action <> 'status' AND (v_step_status IN ('claimed','delivery_uncertain') OR v_pending>0) THEN
      RAISE EXCEPTION 'refund_processing_or_requires_review' USING ERRCODE='P0001';
    END IF;
    -- A failed step under full coverage may still retry: the money
    -- is home but trusted finalization never ran, and rearming is
    -- its only recovery (covered legs never re-initiate).
    IF p_action <> 'status' AND v_remaining<=0
      AND NOT (p_action='retry' AND v_refunded>0
        AND v_step_status='failed' AND v_step_error IS NOT NULL) THEN
      RAISE EXCEPTION 'already_refunded' USING ERRCODE='P0001';
    END IF;
  END IF;

  IF p_action='retry' THEN
    IF v_manual_partial THEN
      RAISE EXCEPTION 'manual_completion_required' USING ERRCODE='P0001';
    END IF;
    -- The worker can only finish what the aggregate finalizer
    -- accepts: finalize_refunded_cancellation_order_v1 rejects a
    -- NULL cancelled_at, so rearming without it would move provider
    -- money and then strand settlement reversal and notifications.
    -- Mirror the manual path's rejection for the same legacy rows.
    IF v_order.cancelled_at IS NULL THEN
      RAISE EXCEPTION 'payment_ledger_requires_review' USING ERRCODE='P0001';
    END IF;
    IF v_step_status IS DISTINCT FROM 'failed' OR v_step_error IS NULL THEN
      RAISE EXCEPTION 'failed_refund_required' USING ERRCODE='P0001';
    END IF;
    UPDATE public.order_cancellation_side_effects SET attempts=0,
      retry_requests=retry_requests+1,last_retry_by=v_actor,last_retry_at=now(),
      claimed_at=now(),error=NULL WHERE order_id=p_order_id AND step='refund'
      RETURNING status,error,attempts,retry_requests INTO v_step_status,v_step_error,v_step_attempts,v_step_retry_requests;
  ELSIF p_action='manual' THEN
    -- Allocation and zero-balance finalization live in the record
    -- helper (part 3); unpack its updated money/step state here.
    -- The leg pin is manual-only: the helper validates and allocates
    -- by it, while retry ignores it (rearming carries no amount).
    v_manual := private.record_manual_order_refund(p_order_id,
      v_order.merchant_id,v_order.currency,v_order.cancelled_at,v_actor,
      p_amount,p_refunded_at,p_method,p_note,p_confirmed,v_reference,
      v_remaining,v_refunded,
      v_step_status,v_step_error,v_step_attempts,v_step_retry_requests,
      p_payment_transaction_id);
    v_refunded := (v_manual->>'refunded')::numeric;
    v_remaining := (v_manual->>'remaining')::numeric;
    v_step_status := v_manual->>'stepStatus';
    v_step_error := v_manual->>'stepError';
    v_step_attempts := (v_manual->>'stepAttempts')::integer;
    v_step_retry_requests := (v_manual->>'stepRetryRequests')::integer;
    -- A manual declared as Paystack is a merchant claim about
    -- provider money, not returned money: reclassify the recorded
    -- amount from coverage to in-flight pending so this response
    -- matches what a follow-up status call computes (and the UI
    -- never flashes refunded while the claim still defers). The
    -- zero-balance upsert above still re-arms the row — the drain
    -- must invoke the claim so the worker API-verifies the claim.
    IF p_method = 'paystack' THEN
      v_refunded := v_refunded - p_amount;
      v_remaining := v_remaining + p_amount;
      v_pending := v_pending + p_amount;
    END IF;
    -- The flag above was computed before this insert: a first manual
    -- record that leaves a balance behind is partial by definition
    -- (the helper raises unless it allocated, and the replay path
    -- implies a pre-existing row), so refresh it or this response
    -- advertises a retry the next call rejects until the next poll.
    v_manual_partial := v_remaining > 0;
  END IF;
  -- Response shaping lives in the response helper (part 3).
  RETURN private.refund_status_response(p_order_id,
    v_order.merchant_id,v_order.currency,v_order.amount_paid,
    v_refunded,v_remaining,v_pending,v_reversed_internal,
    v_step_status,v_step_error,v_step_attempts,v_step_retry_requests,
    v_can_manage,v_manual_partial);
END; $$;
REVOKE ALL ON FUNCTION private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean,uuid)
  FROM PUBLIC,anon,authenticated;
