-- Round-48 P1: persist the refunded label for internal-only
-- cancellations. cancel_order_as_merchant excludes internal gateways
-- from refund-side-effect creation and never calls the refund manager,
-- so a wallet- or savings-only order cancelled outside the refund
-- panel keeps payment_status='paid' forever even though the reversal
-- ledger returned every kobo; the transactions-scoped sync trigger
-- never fires because no refund row lands. Flip the label from the
-- reversal transaction itself when the internal reversals alone cover
-- the paid amount and no external funded leg exists (mixed orders stay
-- with the normal flow, and cash-only orders still wait for the
-- merchant's manual record).
CREATE OR REPLACE FUNCTION private.sync_internal_only_refund_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_order_id uuid;
  v_merchant_id uuid;
  v_reversed_internal numeric;
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
  -- Same internal-reversal measure as the transactions-scoped sync
  -- trigger and the refund manager.
  SELECT (SELECT COALESCE(sum(w.amount), 0)
            FROM public.customer_wallet_transactions w
           WHERE w.source_id = v_order_id
             AND w.merchant_id = v_merchant_id
             AND w.source_type = 'order_reversal')
       + (SELECT COALESCE(sum(r.amount), 0)
            FROM public.customer_savings_redemptions r
           WHERE r.order_id = v_order_id
             AND r.merchant_id = v_merchant_id
             AND r.metadata ? 'reversed_at')
    INTO v_reversed_internal;
  UPDATE public.orders o
     SET payment_status = 'refunded', updated_at = now()
   WHERE o.id = v_order_id AND o.merchant_id = v_merchant_id
     AND o.shipping_status IN ('cancelled', 'canceled')
     -- Funded states that can owe a balance: paid in full, or
     -- partially paid with the remainder covered by reversal. A
     -- partially paid cancellation whose reversals cover
     -- amount_paid is just as terminal and must not keep polling
     -- a paid-family label forever.
     AND o.payment_status IN ('paid', 'partially_paid')
     AND o.amount_paid > 0
     AND o.amount_paid <= v_reversed_internal
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
            'PAY_ON_DELIVERY'));
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
