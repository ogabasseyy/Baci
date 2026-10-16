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
  v_step_last_retry_at timestamptz;
  v_manual jsonb;
  v_manual_partial boolean;
  v_payment_refunded numeric;
  v_payment_pending numeric;
  v_refunded numeric;
  v_pending numeric;
  v_has_movement_evidence boolean;
  v_remaining numeric;
  v_reversed_internal numeric;
  v_paid numeric;
  v_can_manage boolean;
  v_reference text;
  v_sole_external_leg boolean;
  v_sole_leg_gateway text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF p_action NOT IN ('status','retry','manual') THEN
    RAISE EXCEPTION 'invalid_refund_action' USING ERRCODE='22023';
  END IF;
  -- Read first, lock later: taking FOR UPDATE before the auth
  -- checks below would let any authenticated caller pin locks on
  -- orders they may not touch (including foreign-tenant rows),
  -- stalling the drain and other merchants. The plain read cannot
  -- mutate; mutating actions re-lock after authorization.
  SELECT merchant_id,currency,amount_paid,shipping_status,cancelled_at,created_at INTO v_order
    FROM public.orders WHERE id=p_order_id;
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
  -- Status is a pure read: no row locks, so status polling (any
  -- viewer, any cadence) can neither contend with the drain nor
  -- serialize against mutations. Mutating actions re-lock both
  -- rows now that the caller is authorized.
  IF p_action <> 'status' THEN
    SELECT merchant_id,currency,amount_paid,shipping_status,cancelled_at,created_at INTO v_order
      FROM public.orders WHERE id=p_order_id FOR UPDATE;
    SELECT status,error,attempts,retry_requests,last_retry_at
      INTO v_step_status,v_step_error,v_step_attempts,v_step_retry_requests,v_step_last_retry_at
      FROM public.order_cancellation_side_effects
      WHERE order_id=p_order_id AND step='refund' FOR UPDATE;
  ELSE
    SELECT status,error,attempts,retry_requests,last_retry_at
      INTO v_step_status,v_step_error,v_step_attempts,v_step_retry_requests,v_step_last_retry_at
      FROM public.order_cancellation_side_effects
      WHERE order_id=p_order_id AND step='refund';
  END IF;
  -- The mutation re-lock above re-reads the raw row: normalize
  -- again (idempotent) so comparisons below see NGN, not NULL.
  v_order.currency := COALESCE(NULLIF(BTRIM(v_order.currency), ''), 'NGN');
  -- Coverage counts matching money only: a foreign-currency row is an
  -- anomaly for review, and subtracting it would let the merchant
  -- record less than is owed while the order flips refunded. A
  -- locally completed Paystack row (or a manual row declared as
  -- Paystack) counts only after provider verification
  -- (provider_refund_status = 'processed'): counting an unverified
  -- row would understate the remainder while finalization defers,
  -- and unverified rows block manual recording like refund_pending
  -- legs instead of turning into double-recordable invisibility.
  -- Refunds attribute to their linked leg under the claim's
  -- normalized-gateway rules, with the explicit manual-row exception
  -- (a merchant transfer covers any allocated leg): counting a
  -- cross-gateway row would zero the balance while the claim rejects
  -- the evidence. Unlinked rows attribute only to a sole completed
  -- external leg with a matching gateway (manuals never
  -- sole-attribute); unattributable rows wait in pending instead.
  SELECT count(*)=1,
    max(public.normalized_gateway_name_v1(sole.gateway))
    INTO v_sole_external_leg,v_sole_leg_gateway FROM public.transactions sole
    WHERE sole.order_id=p_order_id AND sole.merchant_id=v_order.merchant_id
    AND sole.transaction_type='payment' AND sole.status='completed' AND sole.amount>0
    AND COALESCE(public.normalized_gateway_name_v1(sole.gateway),'') NOT IN (
      'WALLET','SAVINGS','STORE_CREDIT','CASH','MANUAL','PAY_ON_DELIVERY');
  -- Terminal coverage comes capped per payment leg from the shared
  -- helper: an overfunded leg's excess must not zero the remainder
  -- while sibling legs sit uncovered. Pending is the extracted
  -- global-sum helper (split for the 300-line boundary).
  v_refunded := private.capped_refund_coverage_v1(
    p_order_id, v_order.merchant_id, v_order.currency);
  v_pending := private.pending_refund_evidence_v1(p_order_id,
    v_order.merchant_id, v_order.currency,
    v_sole_external_leg, v_sole_leg_gateway);
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
  -- Open movement reviews pin their legs exactly like pending
  -- evidence: a reconciliation review is unresolved provider money,
  -- and resolving it in the reconciliation queue (not by recording
  -- beside it) is the only safe recovery.
  v_has_movement_evidence :=
    private.unresolved_order_movement_evidence_v1(
      p_order_id, v_order.merchant_id);
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
  -- A superseded capture zeroes the paid-minus-coverage remainder
  -- while the executor still owes the uncovered leg: floor at the
  -- per-leg uncovered obligation so recording stays open.
  v_paid := private.effective_amount_paid_v1(p_order_id,
    v_order.merchant_id, v_order.currency, v_order.amount_paid);
  v_remaining := GREATEST(v_paid-v_refunded,
    private.uncovered_refund_obligation_v1(p_order_id,
      v_order.merchant_id, v_order.currency, v_reversed_internal,
      v_paid),0);
  -- Partial-manual state is per leg (extracted helper): a fully
  -- manually covered leg never blocks retry, but a partially
  -- covered leg still needs the merchant to finish first.
  v_manual_partial := private.manual_refund_partial_v1(
    p_order_id, v_remaining);

  IF p_action <> 'status' THEN
    IF v_order.shipping_status NOT IN ('cancelled','canceled') OR v_order.amount_paid <= 0 THEN
      RAISE EXCEPTION 'cancelled_paid_order_required' USING ERRCODE='P0001';
    END IF;
    IF p_action='manual' THEN
      -- Attestation gates the whole manual action, including
      -- idempotent replays: the replay branch below rewrites audit
      -- notes and short-circuits to status before the record helper
      -- (the previous sole enforcement point) is ever reached, so
      -- without this a direct RPC caller could mutate notes
      -- unattested. Same code as the helper for one client mapping.
      IF p_confirmed IS NOT TRUE THEN
        RAISE EXCEPTION 'refund_confirmation_required' USING ERRCODE='22023';
      END IF;
      v_reference := NULLIF(btrim(p_reference),'');
      IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
        OR p_refunded_at IS NULL OR p_refunded_at>now()
        -- Windowed both ways: a pre-order date is an entry error, not a transfer (NULL created_at skips legacy rows).
        OR (v_order.created_at IS NOT NULL AND p_refunded_at<v_order.created_at)
        OR p_method IS NULL OR p_method NOT IN ('paystack','bank_transfer','cash','other')
        OR v_reference IS NULL OR length(v_reference)>100
        OR COALESCE(length(p_note),0)>500 THEN
        RAISE EXCEPTION 'invalid_manual_refund' USING ERRCODE='22023';
      END IF;
      -- Idempotent replay short-circuit (skips the processing gate by
      -- design; its note rewrite freezes under the same condition).
      p_action := private.apply_manual_refund_replay_v1(p_order_id, p_amount, p_refunded_at, p_method, p_reference,
        p_note, v_order.merchant_id, v_step_status IN ('claimed','delivery_uncertain') OR v_pending>0 OR v_has_movement_evidence);
    END IF;
    IF p_action <> 'status' AND (v_step_status IN ('claimed','delivery_uncertain') OR v_pending>0
      OR v_has_movement_evidence) THEN
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
    -- Retry re-arms without a provider call, so nothing else
    -- throttles it: enforce a minimum interval server-side or a
    -- stuck panel (or a script) can requeue every poll, churning
    -- the drain and the audit trail.
    IF v_step_last_retry_at IS NOT NULL
      AND v_step_last_retry_at > now() - interval '60 seconds' THEN
      RAISE EXCEPTION 'retry_too_soon' USING ERRCODE='P0001';
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
    -- The flag above was computed before this insert, so refresh
    -- it against the new rows or this response advertises a retry
    -- the next call rejects until the next poll.
    v_manual_partial := private.manual_refund_partial_v1(
      p_order_id, v_remaining);
  END IF;
  -- Internal-only remainders whose label no trigger persisted still
  -- need the terminal label before a mutation response exposes
  -- refunded (the reversal-ledger sync and backfill own
  -- wallet/savings flips at the ledger; the retry backstop heals
  -- legacy drift on the next re-arm). Mutations only: status
  -- reads admit view-only callers without refund permission or CSRF
  -- protection, so letting them reach this UPDATE would persist
  -- refunds from a read-only path, including while the step still
  -- awaits trusted finalization. The label gates must clear too.
  IF p_action <> 'status' AND v_remaining <= 0 AND v_refunded > 0 THEN
    UPDATE public.orders o SET payment_status = 'refunded', updated_at = now()
     WHERE o.id = p_order_id AND o.merchant_id = v_order.merchant_id
       AND o.payment_status IS DISTINCT FROM 'refunded'
       AND o.shipping_status IN ('cancelled', 'canceled')
       AND private.refund_label_gates_clear_v1(p_order_id, v_order.merchant_id, v_order.currency);
  END IF;
  -- Response shaping lives in the response helper (part 3).
  RETURN private.refund_status_response(p_order_id,
    v_order.merchant_id,v_order.currency,v_paid,
    v_refunded,v_remaining,v_pending,v_reversed_internal,
    v_step_status,v_step_error,v_step_attempts,v_step_retry_requests,
    v_can_manage,v_manual_partial,v_has_movement_evidence,
    v_order.cancelled_at);
END; $$;
REVOKE ALL ON FUNCTION private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean,uuid)
  FROM PUBLIC,anon,authenticated;
