-- Round-48 P1: persist the refunded label for internal-only
-- cancellations. cancel_order_as_merchant excludes internal gateways
-- from refund-side-effect creation and never calls the refund manager,
-- so a wallet- or savings-only order cancelled outside the refund
-- panel keeps its paid-family status forever even though the reversal
-- ledger returned every kobo; the transactions-scoped sync trigger
-- never fires because no refund row lands. Flip the label from the
-- reversal transaction itself when the internal reversals alone cover
-- the paid amount, no external funded leg exists, and every cash-like
-- leg has linked manual coverage (mixed orders stay with the normal
-- flow; an aggregate wallet/savings match must not retire an
-- outstanding cash leg no side effect will ever revisit). A
-- migration-time backfill covers reversals that landed before this
-- trigger existed.
CREATE OR REPLACE FUNCTION private.internal_reversal_coverage_v1(
  p_order_id uuid, p_merchant_id uuid
) RETURNS numeric LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  -- Same internal-reversal measure as the transactions-scoped sync
  -- trigger and the refund manager.
  SELECT (SELECT COALESCE(sum(w.amount), 0)
            FROM public.customer_wallet_transactions w
           WHERE w.source_id = p_order_id
             AND w.merchant_id = p_merchant_id
             AND w.source_type = 'order_reversal')
       + (SELECT COALESCE(sum(r.amount), 0)
            FROM public.customer_savings_redemptions r
           WHERE r.order_id = p_order_id
             AND r.merchant_id = p_merchant_id
             AND r.metadata ? 'reversed_at');
$$;
REVOKE ALL ON FUNCTION private.internal_reversal_coverage_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
-- Effective paid total for legacy NULL-paid internal-only orders:
-- amount_paid is nullable since baseline, and a NULL total beside
-- funded internal legs is real customer money the flip must measure
-- against reversal coverage. Unlike the manager's
-- effective_amount_paid_v1 (which excludes wallet/savings because
-- they reverse through their own ledgers), the internal set counts
-- here: wallet/savings legs ARE the funded evidence for these
-- orders. Missing currency or no funded legs derives zero, which
-- fails the flip's positive-paid gate like before.
CREATE OR REPLACE FUNCTION private.internal_only_effective_paid_v1(
  p_order_id uuid, p_merchant_id uuid
) RETURNS numeric LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT COALESCE(
    (SELECT o.amount_paid FROM public.orders o
      WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id),
    COALESCE((SELECT SUM(leg.amount)
      FROM public.transactions leg
      JOIN public.orders o
        ON o.id = leg.order_id AND o.merchant_id = leg.merchant_id
     WHERE leg.order_id = p_order_id AND leg.merchant_id = p_merchant_id
       AND leg.transaction_type = 'payment'
       AND leg.status IN ('completed', 'refund_pending', 'refunded')
       AND leg.amount > 0
       AND UPPER(BTRIM(leg.currency)) = UPPER(BTRIM(o.currency))
       AND COALESCE(public.normalized_gateway_name_v1(leg.gateway), '')
           IN ('WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL',
               'PAY_ON_DELIVERY')), 0));
$$;
REVOKE ALL ON FUNCTION private.internal_only_effective_paid_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
-- Single flip predicate shared by the trigger and the backfill so
-- the two can never disagree about which orders qualify.
CREATE OR REPLACE FUNCTION private.flip_internal_only_order_refunded(
  p_order_id uuid, p_merchant_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  UPDATE public.orders o
     SET payment_status = 'refunded', updated_at = now()
   WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id
     AND o.shipping_status IN ('cancelled', 'canceled')
     AND o.payment_status IN ('paid', 'partially_paid', 'pending')
     AND private.internal_only_effective_paid_v1(
       p_order_id, p_merchant_id) > 0
     AND private.internal_only_effective_paid_v1(
       p_order_id, p_merchant_id)
       <= private.internal_reversal_coverage_v1(
         p_order_id, p_merchant_id)
     -- Mirror the cancel-time side-effect gate negated: any external
     -- funded leg keeps the label with the normal (transaction or
     -- manager) flow, which also requires per-leg coverage.
     AND NOT EXISTS (
       SELECT 1 FROM public.transactions t
        WHERE t.order_id = o.id AND t.merchant_id = o.merchant_id
          AND t.transaction_type = 'payment'
          AND t.status IN ('completed', 'refund_pending', 'refunded')
          AND t.amount > 0
          AND COALESCE(
                public.normalized_gateway_name_v1(t.gateway), ''
              ) NOT IN (
            'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL',
            'PAY_ON_DELIVERY'))
    -- Cash-like legs need full manual coverage before the label
    -- flips: an aggregate wallet/savings match on an overfunded or
    -- superseded ledger must not retire outstanding cash no side
    -- effect will ever revisit. Mirrors the finalizer guard's
    -- internal-leg coverage check exactly.
    AND NOT EXISTS (
      SELECT 1 FROM public.transactions leg
       WHERE leg.order_id = o.id AND leg.merchant_id = o.merchant_id
         AND leg.transaction_type = 'payment'
         AND leg.status IN ('completed', 'refund_pending', 'refunded')
         AND COALESCE(
               public.normalized_gateway_name_v1(leg.gateway), ''
             ) IN (
           'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY')
         AND (
           SELECT COALESCE(SUM(refund.amount), 0)
             FROM public.transactions refund
            WHERE refund.order_id = o.id
              AND refund.merchant_id = o.merchant_id
              AND refund.transaction_type = 'refund'
              AND refund.status IN ('completed', 'refunded')
              AND refund.amount > 0
              AND UPPER(BTRIM(refund.currency))
                = UPPER(BTRIM(leg.currency))
              AND public.normalized_gateway_name_v1(refund.gateway)
                = 'MANUAL'
              AND refund.metadata->>'payment_transaction_id'
                = leg.id::text
              AND (
                refund.metadata->>'method' IS DISTINCT FROM 'paystack'
                OR refund.metadata->>'provider_refund_status' = 'processed'
              )
         ) < leg.amount);
END; $$;
REVOKE ALL ON FUNCTION private.flip_internal_only_order_refunded(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.sync_internal_only_refund_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_order_id uuid;
  v_merchant_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'customer_wallet_transactions' THEN
    IF NEW.source_type IS DISTINCT FROM 'order_reversal'
       OR NEW.source_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_order_id := NEW.source_id;
    v_merchant_id := NEW.merchant_id;
  ELSIF TG_TABLE_NAME = 'customer_savings_events' THEN
    IF NEW.event_type IS DISTINCT FROM 'savings_order_redemption_reversed' THEN
      RETURN NEW;
    END IF;
    BEGIN
      v_order_id := NULLIF(NEW.metadata->>'order_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NEW;
    END;
    v_merchant_id := NEW.merchant_id;
  ELSE
    RETURN NEW;
  END IF;
  IF v_order_id IS NULL OR v_merchant_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM private.flip_internal_only_order_refunded(
    v_order_id, v_merchant_id);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.sync_internal_only_refund_status()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sync_internal_only_refund_status_wallet
  ON public.customer_wallet_transactions;
CREATE TRIGGER sync_internal_only_refund_status_wallet
  AFTER INSERT ON public.customer_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION private.sync_internal_only_refund_status();
DROP TRIGGER IF EXISTS sync_internal_only_refund_status_savings
  ON public.customer_savings_events;
CREATE TRIGGER sync_internal_only_refund_status_savings
  AFTER INSERT ON public.customer_savings_events
  FOR EACH ROW EXECUTE FUNCTION private.sync_internal_only_refund_status();
-- Backfill reversals that landed before the triggers above existed.
-- A callable function (not a bare statement) so the regression suite
-- exercises the exact shipped predicate against a simulated
-- pre-migration row instead of duplicating it.
CREATE OR REPLACE FUNCTION private.backfill_internal_only_refund_status()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id, o.merchant_id
      FROM public.orders o
     WHERE o.shipping_status IN ('cancelled', 'canceled')
       AND o.payment_status IN ('paid', 'partially_paid', 'pending')
       AND private.internal_only_effective_paid_v1(
         o.id, o.merchant_id) > 0
       -- The flip needs reversal coverage above zero, so only orders
       -- with reversal ledger evidence can qualify: skip the flip's
       -- EXISTS/subquery chain for every other cancelled order. A
       -- strict superset of flippable rows (coverage > 0 implies a
       -- reversal row), so the flipped set is unchanged.
       AND (EXISTS (
         SELECT 1 FROM public.customer_wallet_transactions w
          WHERE w.source_id = o.id AND w.merchant_id = o.merchant_id
            AND w.source_type = 'order_reversal')
         -- Alias red, not r: r is the loop's record variable and
         -- plpgsql binds unqualified alias references to it first.
         OR EXISTS (
           SELECT 1 FROM public.customer_savings_redemptions red
          WHERE red.order_id = o.id AND red.merchant_id = o.merchant_id
            AND red.metadata ? 'reversed_at'))
  LOOP
    PERFORM private.flip_internal_only_order_refunded(r.id, r.merchant_id);
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION private.backfill_internal_only_refund_status()
  FROM PUBLIC, anon, authenticated;
SELECT private.backfill_internal_only_refund_status();
