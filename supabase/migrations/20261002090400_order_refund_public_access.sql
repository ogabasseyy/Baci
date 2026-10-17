-- Public refund access (5/5): the narrow authenticated delegate plus
-- the status trigger that flips cancelled orders to refunded once
-- per-leg coverage lands. Depends on parts 1-4.

-- Preserve the repository boundary: authenticated callers have no private-schema usage.
-- This narrow delegate executes only the private function, which checks auth.uid and permissions.
DROP FUNCTION IF EXISTS public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text);
DROP FUNCTION IF EXISTS public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean);
CREATE OR REPLACE FUNCTION public.manage_order_refund(
  p_order_id uuid,p_action text DEFAULT 'status',p_amount numeric DEFAULT NULL,
  p_refunded_at timestamptz DEFAULT NULL,p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,p_note text DEFAULT NULL,
  p_confirmed boolean DEFAULT NULL,p_payment_transaction_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.manage_order_refund(p_order_id,p_action,p_amount,p_refunded_at,p_method,p_reference,p_note,p_confirmed,p_payment_transaction_id);
$$;
REVOKE ALL ON FUNCTION public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean,uuid)
  TO authenticated;

-- Round-60 P2: the refunded label may land only when no pending
-- or anomalous refund evidence survives. The manager keeps
-- reporting processing while any in-flight, unverified,
-- currency-mismatched, or invalid-link refund exists, and the
-- aggregate finalization helper refuses the same order, so
-- flipping on coverage alone leaves reports and other
-- payment_status consumers inconsistent with the refund worker.
-- Mirrors the trailing gate arms of
-- private.cancellation_refund_legs_covered_v1 verbatim (see that
-- helper for the full rationale); it is created later in the
-- chain, so the trigger and the migration-time backfill below
-- cannot call it here.
CREATE OR REPLACE FUNCTION private.refund_label_gates_clear_v1(
  p_order_id uuid, p_merchant_id uuid, p_currency text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_sole_external_leg boolean;
  v_sole_leg_gateway text;
BEGIN
  -- Confinement first, like the sibling coverage helpers: EXECUTE is
  -- granted to authenticated (denial-path rationale below), so without
  -- an in-function gate a direct call probes another tenant's refund
  -- evidence. View-level, mirroring the manager; uid-less
  -- service_role trigger and backfill contexts bypass.
  PERFORM private.assert_refund_helper_membership_v1(p_merchant_id);
  -- Sole-leg attribution mirrors the manager verbatim: an unlinked
  -- refund attributes only to the single completed external leg.
  SELECT count(*)=1,
    max(public.normalized_gateway_name_v1(sole.gateway))
    INTO v_sole_external_leg,v_sole_leg_gateway FROM public.transactions sole
   WHERE sole.order_id=p_order_id AND sole.merchant_id=p_merchant_id
     AND sole.transaction_type='payment' AND sole.status='completed' AND sole.amount>0
     AND COALESCE(public.normalized_gateway_name_v1(sole.gateway),'') NOT IN (
       'WALLET','SAVINGS','STORE_CREDIT','CASH','MANUAL','PAY_ON_DELIVERY');
  RETURN NOT EXISTS (
    -- Unverified Paystack evidence blocks the label whether it is a
    -- merchant declaration or an ordinary provider row.
    SELECT 1 FROM public.transactions merchant_claim
     WHERE merchant_claim.order_id=p_order_id
       AND merchant_claim.merchant_id=p_merchant_id
       AND merchant_claim.transaction_type='refund'
       AND merchant_claim.status IN ('completed','refunded')
       AND UPPER(BTRIM(merchant_claim.currency))
         = UPPER(BTRIM(COALESCE(NULLIF(BTRIM(p_currency),''),'NGN')))
       AND (public.normalized_gateway_name_v1(merchant_claim.gateway)='PAYSTACK'
         OR (public.normalized_gateway_name_v1(merchant_claim.gateway)='MANUAL'
           AND merchant_claim.metadata->>'method'='paystack'))
       AND merchant_claim.metadata->>'provider_refund_status'
         IS DISTINCT FROM 'processed'
       AND (merchant_claim.metadata->>'payment_transaction_id' IS NULL
         OR EXISTS (SELECT 1 FROM public.transactions leg
           WHERE leg.id::text
             = merchant_claim.metadata->>'payment_transaction_id'
             AND leg.order_id=p_order_id AND leg.merchant_id=p_merchant_id
             AND leg.transaction_type='payment'
             AND leg.status IN ('completed','refund_pending','refunded'))))
  AND NOT EXISTS (
    -- In-flight refund evidence blocks the label even when every
    -- leg is terminally covered; only definitively failed rows
    -- are dead enough to ignore, and a failed provider row is
    -- definitive only once a fresh provider check stamps
    -- non-acceptance (the verified-record function still accepts
    -- a later processed verdict for it). Rows without a provider
    -- refund id never gate: no verdict can ever land on them.
    SELECT 1 FROM public.transactions in_flight
     WHERE in_flight.order_id=p_order_id
       AND in_flight.merchant_id=p_merchant_id
       AND in_flight.transaction_type='refund'
       AND (in_flight.status NOT IN ('completed','refunded','failed')
         OR (in_flight.status='failed'
           AND in_flight.gateway_reference ~ '^[0-9]+$'
           AND (public.normalized_gateway_name_v1(in_flight.gateway)
             IS NOT DISTINCT FROM 'PAYSTACK'
             OR (public.normalized_gateway_name_v1(in_flight.gateway)='MANUAL'
               AND in_flight.metadata->>'method'='paystack'))
           AND in_flight.metadata->>'provider_refund_status'
             IS DISTINCT FROM 'failed')))
  AND NOT EXISTS (
    -- Anomalous terminal evidence blocks the label exactly like
    -- the manager's pending gate: a currency-mismatched,
    -- link/gateway-mismatched, or invalid-link row keeps the
    -- manager reporting pending.
    SELECT 1 FROM public.transactions anomaly
     WHERE anomaly.order_id=p_order_id
       AND anomaly.merchant_id=p_merchant_id
       AND anomaly.transaction_type='refund'
       AND anomaly.status IN ('completed','refunded')
       AND (UPPER(BTRIM(anomaly.currency))
           IS DISTINCT FROM UPPER(BTRIM(COALESCE(NULLIF(BTRIM(p_currency),''),'NGN')))
         OR NOT COALESCE((EXISTS (SELECT 1 FROM public.transactions leg
             WHERE leg.id::text=anomaly.metadata->>'payment_transaction_id'
               AND leg.order_id=p_order_id AND leg.merchant_id=p_merchant_id
               AND leg.transaction_type='payment'
               AND leg.status IN ('completed','refund_pending','refunded')
               AND (public.normalized_gateway_name_v1(anomaly.gateway)='MANUAL'
                 OR public.normalized_gateway_name_v1(anomaly.gateway)
                   = public.normalized_gateway_name_v1(leg.gateway)))
           OR (anomaly.metadata->>'payment_transaction_id' IS NULL
             AND v_sole_external_leg
             AND public.normalized_gateway_name_v1(anomaly.gateway)=v_sole_leg_gateway)),false)))
  AND NOT EXISTS (
    -- A foreign-currency self-terminal refunded leg counts as
    -- returned only in the order currency.
    SELECT 1 FROM public.transactions self_terminal
     WHERE self_terminal.order_id=p_order_id
       AND self_terminal.merchant_id=p_merchant_id
       AND self_terminal.transaction_type='payment'
       AND self_terminal.status='refunded'
       AND self_terminal.amount>0
       AND UPPER(BTRIM(self_terminal.currency))
         IS DISTINCT FROM UPPER(BTRIM(COALESCE(NULLIF(BTRIM(p_currency),''),'NGN'))));
END; $$;
REVOKE ALL ON FUNCTION private.refund_label_gates_clear_v1(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
-- Like the sibling coverage helpers: service_role fires the sync
-- trigger, and authenticated EXECUTE keeps any hypothetical direct
-- call on the clean schema-USAGE denial instead of the crashing
-- function-ACL path (see the coverage migration).
GRANT EXECUTE ON FUNCTION private.refund_label_gates_clear_v1(uuid,uuid,text)
  TO service_role, authenticated;

-- A provider confirmation updates payment status without changing amount paid.
CREATE OR REPLACE FUNCTION private.sync_cancelled_order_refund_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_reversed_internal numeric;
BEGIN
  -- Order-less ledger refunds (e.g. the PiggyVest external-principal flow)
  -- have no order to audit: the events table requires order_id, so skip
  -- them instead of rolling their insert back on the NOT NULL check.
  IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
  -- The audit event fires for terminal refund rows only; the payment
  -- label below also runs when a self-terminal payment leg (e.g. PayPal
  -- flips the payment row itself) lands, since no refund row arrives.
  IF (NEW.transaction_type='refund' AND NEW.status IN ('completed','refunded'))
    OR (NEW.transaction_type='payment' AND NEW.status='refunded') THEN
    -- Proof stamps reassign the same status to refire the label sync
    -- below; the record was already audited at insert, so only a new
    -- row or a real status transition logs again.
    IF NEW.transaction_type='refund'
      AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      INSERT INTO public.order_refund_events(order_id,merchant_id,actor_id,action,details)
      VALUES (NEW.order_id,NEW.merchant_id,auth.uid(),
        CASE WHEN NEW.gateway='manual' THEN 'manual_recorded' ELSE 'provider_confirmed' END,
        jsonb_build_object('amount',NEW.amount,
          'reference',COALESCE(NEW.metadata->>'reference',NEW.gateway_reference)));
    END IF;
    SELECT (SELECT COALESCE(sum(w.amount),0)
              FROM public.customer_wallet_transactions w
             WHERE w.source_id=NEW.order_id AND w.merchant_id=NEW.merchant_id
               AND w.source_type='order_reversal')
         + (SELECT COALESCE(sum(r.amount),0)
              FROM public.customer_savings_redemptions r
             WHERE r.order_id=NEW.order_id AND r.merchant_id=NEW.merchant_id
               AND r.metadata ? 'reversed_at')
      INTO v_reversed_internal;
    -- Coverage counts matching money only (a foreign-currency row must
    -- not flip the label while matching money is still owed), capped
    -- per payment leg via the shared helper so an overfunded leg's
    -- excess cannot flip the label while sibling legs sit uncovered,
    -- and includes self-terminal refunded payment legs. The amount
    -- test alone cannot prove every funded leg is covered (a
    -- superseded capture's reversal satisfies it beside an
    -- outstanding live capture), so the transition additionally
    -- requires zero per-leg uncovered obligation. The label
    -- additionally waits for clear pending/anomaly gates: while
    -- any in-flight, unverified, currency-mismatched, or
    -- invalid-link refund survives, the manager reports
    -- processing and the aggregate finalizer refuses, so the
    -- label must not claim refunded first.
    UPDATE public.orders o SET payment_status='refunded',updated_at=now()
      WHERE o.id=NEW.order_id AND o.merchant_id=NEW.merchant_id
        AND o.shipping_status IN ('cancelled','canceled')
        AND private.effective_amount_paid_v1(
          o.id, o.merchant_id, o.currency, o.amount_paid) > 0
        AND private.refund_label_gates_clear_v1(
          o.id, o.merchant_id, o.currency)
        AND private.effective_amount_paid_v1(
          o.id, o.merchant_id, o.currency, o.amount_paid)
          <= private.capped_refund_coverage_v1(
            o.id, o.merchant_id, o.currency)
        + (SELECT COALESCE(sum(p.amount),0) FROM public.transactions p
          WHERE p.order_id=o.id AND p.merchant_id=o.merchant_id
            AND p.transaction_type='payment' AND p.status='refunded' AND p.amount>0
            -- Legacy null-currency orders price in NGN like the
            -- manager and helper: without the default this
            -- comparison is NULL and the leg never counts.
            AND upper(btrim(p.currency))=upper(COALESCE(NULLIF(BTRIM(o.currency),''),'NGN'))
            AND COALESCE(public.normalized_gateway_name_v1(p.gateway),'') NOT IN (
              'WALLET','SAVINGS','STORE_CREDIT','CASH','MANUAL','PAY_ON_DELIVERY'))
        + v_reversed_internal
        AND private.uncovered_refund_obligation_v1(o.id, o.merchant_id,
          o.currency, v_reversed_internal, private.effective_amount_paid_v1(
            o.id, o.merchant_id, o.currency, o.amount_paid)) <= 0;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.sync_cancelled_order_refund_status() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sync_cancelled_order_refund_status ON public.transactions;
CREATE TRIGGER sync_cancelled_order_refund_status AFTER INSERT OR UPDATE OF status
  ON public.transactions FOR EACH ROW EXECUTE FUNCTION private.sync_cancelled_order_refund_status();

-- Round-59 P2: the trigger above only fires for terminal rows that
-- land after this migration. Cancelled orders whose terminal
-- refund evidence predates it (a fully covered cash/manual or
-- non-Paystack order still storing a paid-family label) would stay
-- stale for reports and other database consumers even though the
-- status read computes refunded, so repair them once here with the
-- trigger's own coverage predicate. Label-only like the trigger:
-- the money is already provably home.
CREATE OR REPLACE FUNCTION private.backfill_cancelled_order_refund_status()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  -- Service-role only, enforced in-function like the sweep selector:
  -- EXECUTE is withheld from authenticated (ACL below), but ACL
  -- denial alone proved environment-sensitive in DB Replay while
  -- in-function 42501s held, so the body re-checks the JWT role.
  -- NULL role (migration-time and superuser connections carry no
  -- JWT) stays allowed for the call below.
  IF auth.role() IS NOT NULL
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  -- Bound lock waits: worker transactions are short, so a longer
  -- wait means a wedged row — fail the statement loudly instead of
  -- hanging the migration behind it. The label-gated WHERE makes
  -- the call re-runnable, so a re-run completes the skipped rows.
  SET LOCAL lock_timeout = '10s';
  UPDATE public.orders o SET payment_status='refunded',updated_at=now()
   WHERE o.shipping_status IN ('cancelled','canceled')
     AND private.effective_amount_paid_v1(
       o.id, o.merchant_id, o.currency, o.amount_paid) > 0
     AND o.payment_status IN ('paid','partially_paid','pending','bnpl_approved')
     AND private.refund_label_gates_clear_v1(o.id, o.merchant_id, o.currency)
     AND private.effective_amount_paid_v1(
       o.id, o.merchant_id, o.currency, o.amount_paid)
       <= private.capped_refund_coverage_v1(
           o.id, o.merchant_id, o.currency)
       + (SELECT COALESCE(sum(p.amount),0) FROM public.transactions p
            WHERE p.order_id=o.id AND p.merchant_id=o.merchant_id
              AND p.transaction_type='payment' AND p.status='refunded' AND p.amount>0
              AND upper(btrim(p.currency))=upper(COALESCE(NULLIF(BTRIM(o.currency),''),'NGN'))
              AND COALESCE(public.normalized_gateway_name_v1(p.gateway),'') NOT IN (
                'WALLET','SAVINGS','STORE_CREDIT','CASH','MANUAL','PAY_ON_DELIVERY'))
       + (SELECT COALESCE(sum(w.amount),0)
            FROM public.customer_wallet_transactions w
           WHERE w.source_id=o.id AND w.merchant_id=o.merchant_id
             AND w.source_type='order_reversal')
       + (SELECT COALESCE(sum(r.amount),0)
            FROM public.customer_savings_redemptions r
           WHERE r.order_id=o.id AND r.merchant_id=o.merchant_id
             AND r.metadata ? 'reversed_at')
     AND private.uncovered_refund_obligation_v1(o.id, o.merchant_id,
       o.currency,
       (SELECT COALESCE(sum(w.amount),0)
          FROM public.customer_wallet_transactions w
         WHERE w.source_id=o.id AND w.merchant_id=o.merchant_id
           AND w.source_type='order_reversal')
       + (SELECT COALESCE(sum(r.amount),0)
          FROM public.customer_savings_redemptions r
         WHERE r.order_id=o.id AND r.merchant_id=o.merchant_id
           AND r.metadata ? 'reversed_at'),
       private.effective_amount_paid_v1(
         o.id, o.merchant_id, o.currency, o.amount_paid)) <= 0;
END; $$;
REVOKE ALL ON FUNCTION private.backfill_cancelled_order_refund_status()
  FROM PUBLIC,anon,authenticated;
-- Unlike the sibling helpers, authenticated gets no EXECUTE: the
-- backfill flips labels fleet-wide with no end-user identity, so a
-- hypothetical direct call must fail closed even if schema USAGE is
-- ever granted. service_role keeps EXECUTE for the migration-time
-- call below and the round-61 suite.
GRANT EXECUTE ON FUNCTION private.backfill_cancelled_order_refund_status()
  TO service_role;
SELECT private.backfill_cancelled_order_refund_status();
