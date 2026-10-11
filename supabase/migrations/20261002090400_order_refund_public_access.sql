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

-- A provider confirmation updates payment status without changing amount paid.
CREATE OR REPLACE FUNCTION private.sync_cancelled_order_refund_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
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
    IF NEW.transaction_type='refund' THEN
      INSERT INTO public.order_refund_events(order_id,merchant_id,actor_id,action,details)
      VALUES (NEW.order_id,NEW.merchant_id,auth.uid(),
        CASE WHEN NEW.gateway='manual' THEN 'manual_recorded' ELSE 'provider_confirmed' END,
        jsonb_build_object('amount',NEW.amount,
          'reference',COALESCE(NEW.metadata->>'reference',NEW.gateway_reference)));
    END IF;
    -- Coverage counts matching money only (a foreign-currency row must
    -- not flip the label while matching money is still owed), capped
    -- per payment leg via the shared helper so an overfunded leg's
    -- excess cannot flip the label while sibling legs sit uncovered,
    -- and includes self-terminal refunded payment legs.
    UPDATE public.orders o SET payment_status='refunded',updated_at=now()
      WHERE o.id=NEW.order_id AND o.merchant_id=NEW.merchant_id
        AND o.shipping_status IN ('cancelled','canceled') AND o.amount_paid>0
        AND o.amount_paid <= private.capped_refund_coverage_v1(
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
        + (SELECT COALESCE(sum(w.amount),0) FROM public.customer_wallet_transactions w
          WHERE w.source_id=o.id AND w.merchant_id=o.merchant_id
            AND w.source_type='order_reversal')
        + (SELECT COALESCE(sum(r.amount),0) FROM public.customer_savings_redemptions r
          WHERE r.order_id=o.id AND r.merchant_id=o.merchant_id
            AND r.metadata ? 'reversed_at');
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.sync_cancelled_order_refund_status() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sync_cancelled_order_refund_status ON public.transactions;
CREATE TRIGGER sync_cancelled_order_refund_status AFTER INSERT OR UPDATE OF status
  ON public.transactions FOR EACH ROW EXECUTE FUNCTION private.sync_cancelled_order_refund_status();
