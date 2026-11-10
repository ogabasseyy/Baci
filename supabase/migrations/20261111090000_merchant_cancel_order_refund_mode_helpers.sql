-- Helpers and schema for merchant cancellation with a refund choice
-- (20261111090100_merchant_cancel_order_refund_mode.sql). The in-flight
-- payment gate and the verified-capture transition move here unchanged from
-- public.cancel_order_as_merchant (20260928185300) so the main migration
-- stays within the module size limit; the main function calls them.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancellation_refund_mode text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'orders_cancellation_refund_mode_check'
       AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_cancellation_refund_mode_check
      CHECK (
        cancellation_refund_mode IS NULL
        OR cancellation_refund_mode IN ('automatic', 'manual')
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.orders
  VALIDATE CONSTRAINT orders_cancellation_refund_mode_check;

-- Column reads go through column-level grants on orders (table SELECT was
-- revoked), so the new column needs its own grant. Merchant dashboards and
-- the cancel route read it; storefront (anon) never does.
GRANT SELECT (cancellation_refund_mode) ON TABLE public.orders TO authenticated;

-- The mode decides whether a refund is sent, so it must only change inside
-- the cancel RPC (SECURITY DEFINER, so current_user is its owner there). A
-- direct PostgREST write from an authenticated or anon session could flip
-- an automatic cancellation to manual and suppress the refund. service_role
-- is deliberately not blocked: it is trusted server-side code (workers and
-- operations), never reachable from a browser session.
CREATE OR REPLACE FUNCTION private.guard_order_cancellation_refund_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.cancellation_refund_mode IS DISTINCT FROM (
       CASE WHEN TG_OP = 'UPDATE' THEN OLD.cancellation_refund_mode END
     ) THEN
    RAISE EXCEPTION 'cancellation_refund_mode_protected'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_order_cancellation_refund_mode()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS orders_guard_cancellation_refund_mode ON public.orders;
CREATE TRIGGER orders_guard_cancellation_refund_mode
  BEFORE INSERT OR UPDATE OF cancellation_refund_mode ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_order_cancellation_refund_mode();

CREATE OR REPLACE FUNCTION private.merchant_cancel_payment_in_flight(
  p_order_id uuid,
  p_merchant_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.transactions t
     WHERE t.order_id = p_order_id
       AND t.merchant_id = p_merchant_id
       AND t.transaction_type = 'payment'
       AND t.status IN ('pending', 'processing')
       -- Reviewed attempts are ops-owned, but only auto-handled or
       -- provably fundless legs cancel past: verified captures
       -- transition below, while missing/invalid references and
       -- provider-terminal verdicts can neither hold funds nor
       -- complete later. Mismatch and conflict stamps keep blocking
       -- until operations closes every review on the leg (own entry
       -- or merged evidence): cancelling past funds-plausible legs
       -- would strand a captured charge with no refund leg, and the
       -- sweep never reselects stamped rows so nothing else retires
       -- them. The hatch admits only those known manual-review
       -- resolutions — an unknown stamp with no recognized review
       -- would otherwise pass the NOT EXISTS trivially. The
       -- unstamped disjunct keeps the genuine in-flight block total:
       -- NOT over a NULL stamp test would evaluate to NULL and let
       -- unstamped legs slip through.
       AND (
         t.metadata->'abandoned_sweep_resolution' IS NULL
         OR NOT (
           t.metadata->>'abandoned_sweep_resolution' IN (
             'partial_capture_short_reviewed',
             'verified_success_captured',
             'missing_reference',
             'invalid_reference',
             'terminal_evidence_mismatch'
           )
           OR (
             t.metadata->>'abandoned_sweep_resolution' IN (
               'verified_capture_mismatch_reviewed',
               'merchant_invoice_partial_conflict_reviewed'
             )
             AND NOT EXISTS (
               SELECT 1 FROM public.reconciliation_review r
                WHERE r.resolved_at IS NULL
                  AND (
                    r.txn_id = t.id
                    OR r.metadata->'captured_attempts' ? t.id::text
                    OR r.metadata->'mismatched_attempts' ? t.id::text
                  )
             )
           )
         )
       )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.merchant_cancel_payment_in_flight(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.transition_verified_abandoned_captures_for_cancel(
  p_order_id uuid,
  p_merchant_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_leg record;
  v_captured_minor numeric;
  v_captured_text text;
  v_transitioned integer;
BEGIN
  -- Verified-captured abandoned legs retire pending with a stamp the
  -- gate carves out — but pending legs are invisible to the refund
  -- flow, so cancelling now would finalize the order as refunded
  -- while the captured funds stay charged. Transition each leg the
  -- sweep verified into a completed leg at its captured value: the
  -- refund insertion, executor, coverage matcher, and aggregate
  -- finalization below all run standard from there. Runs after the
  -- ledger guard (which validates the pre-transition state) and
  -- before the cancel update, inside the same order lock and
  -- transaction: a concurrent webhook completion wins the status
  -- guard and covers the leg normally, and any later failure rolls
  -- the transition back with the cancel. Only short and overpayment
  -- resolutions transition — their open reviews durably record the
  -- verified captured amount. Mismatch and conflict stamps have no
  -- verified amount to complete with, so those legs stay gate-
  -- blocked pending for operations. Legs whose review operations
  -- already resolved are likewise left alone: closing the review
  -- accepted responsibility for the funds.
  FOR v_leg IN
    SELECT t.id, t.amount, t.metadata->>'abandoned_sweep_resolution' AS resolution
      FROM public.transactions t
     WHERE t.order_id = p_order_id
       AND t.merchant_id = p_merchant_id
       AND t.transaction_type = 'payment'
       AND t.status IN ('pending', 'processing')
       AND t.gateway_reference IS NOT NULL
       AND t.metadata->>'abandoned_sweep_resolution' IN (
         'partial_capture_short_reviewed', 'verified_success_captured'
       )
  LOOP
    v_captured_text := NULL;
    IF v_leg.resolution = 'partial_capture_short_reviewed' THEN
      SELECT r.metadata->>'capture_amount_minor' INTO v_captured_text
        FROM public.reconciliation_review r
       WHERE r.txn_id = v_leg.id
         AND r.issue_type = 'partial_capture_short_requires_review'
         AND r.resolved_at IS NULL
       ORDER BY r.created_at DESC
       LIMIT 1;
      IF v_captured_text IS NULL THEN
        SELECT r.metadata->'short_captures'->v_leg.id::text->>'capture_amount_minor'
          INTO v_captured_text
          FROM public.reconciliation_review r
         WHERE r.order_id = p_order_id
           AND r.issue_type = 'partial_capture_short_requires_review'
           AND r.resolved_at IS NULL
           AND r.metadata->'short_captures' ? v_leg.id::text
         ORDER BY r.created_at DESC
         LIMIT 1;
      END IF;
    ELSE
      SELECT r.metadata->>'provider_amount' INTO v_captured_text
        FROM public.reconciliation_review r
       WHERE r.txn_id = v_leg.id
         AND r.issue_type = 'duplicate_payment_capture_requires_review'
         AND r.resolved_at IS NULL
       ORDER BY r.created_at DESC
       LIMIT 1;
      IF v_captured_text IS NULL THEN
        SELECT r.metadata->'captured_attempts'->v_leg.id::text->>'provider_amount'
          INTO v_captured_text
          FROM public.reconciliation_review r
         WHERE r.order_id = p_order_id
           AND r.issue_type = 'duplicate_payment_capture_requires_review'
           AND r.resolved_at IS NULL
           AND r.metadata->'captured_attempts' ? v_leg.id::text
         ORDER BY r.created_at DESC
         LIMIT 1;
      END IF;
    END IF;
    IF v_captured_text IS NULL OR v_captured_text !~ '^[0-9]+$' THEN
      CONTINUE;
    END IF;
    v_captured_minor := v_captured_text::numeric;
    IF v_captured_minor IS NULL OR v_captured_minor <= 0 THEN
      CONTINUE;
    END IF;
    UPDATE public.transactions
       SET status = 'completed',
           amount = v_captured_minor / 100.0,
           metadata = metadata || jsonb_build_object(
             'original_attempt_amount', v_leg.amount,
             'abandoned_capture_transitioned_for_cancellation',
             jsonb_build_object(
               'captured_amount_minor', v_captured_minor,
               'resolution', v_leg.resolution,
               'transitioned_at', now()
             )
           ),
           updated_at = now()
     WHERE id = v_leg.id
       AND status IN ('pending', 'processing');
    GET DIAGNOSTICS v_transitioned = ROW_COUNT;
    IF v_transitioned = 0 THEN
      CONTINUE;
    END IF;
    UPDATE public.orders
       SET amount_paid = COALESCE(amount_paid, 0) + v_captured_minor / 100.0,
           updated_at = now()
     WHERE id = p_order_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION private.transition_verified_abandoned_captures_for_cancel(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
