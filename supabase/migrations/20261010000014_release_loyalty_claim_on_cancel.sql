-- Release loyalty claims when their order cancels (issue #3165).
--
-- Claim linkage is reward_redemptions.used_on_order_id, stamped by the
-- checkout bridge. Cancel paths set shipping_status = 'cancelled'
-- (customer, merchant, inventory-release RPCs) or only
-- payment_status = 'cancelled' (mark_abandoned_orders), so the trigger
-- watches both fields and restores the code without touching points
-- (spent at redeem; the code simply becomes spendable again) or stock
-- (consumed at redeem, not at claim). Effective cancellation everywhere
-- in this series means either field is 'cancelled'.
CREATE OR REPLACE FUNCTION public.release_loyalty_claims_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Both terminal spellings count: the order update schema accepts
  -- 'cancelled' and 'canceled', and the routes treat both as terminal.
  IF (public.loyalty_status_is_cancelled(NEW.shipping_status)
      AND NOT public.loyalty_status_is_cancelled(OLD.shipping_status))
     OR (public.loyalty_status_is_cancelled(NEW.payment_status)
      AND NOT public.loyalty_status_is_cancelled(OLD.payment_status)) THEN
    -- SKIP LOCKED: a checkout retry can hold a claim row while waiting
    -- on this order (redemption->order); waiting here would invert to
    -- order->redemption and deadlock. Skipped rows stay stamped to a
    -- terminally cancelled order, which the wrapper treats as released.
    UPDATE public.reward_redemptions AS rr
    SET used = false, used_on_order_id = NULL, used_at = NULL
    WHERE rr.used_on_order_id = NEW.id
      AND rr.id IN (
        SELECT locked.id
        FROM public.reward_redemptions AS locked
        WHERE locked.used_on_order_id = NEW.id
        FOR UPDATE SKIP LOCKED
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS release_loyalty_claims_on_order_cancel ON public.orders;
CREATE TRIGGER release_loyalty_claims_on_order_cancel
  AFTER UPDATE OF shipping_status, payment_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.release_loyalty_claims_on_order_cancel();

-- The trigger's release lookup must not seq-scan redemptions per cancel.
CREATE INDEX IF NOT EXISTS loyalty_claim_release_order_idx
  ON public.reward_redemptions (used_on_order_id)
  WHERE used_on_order_id IS NOT NULL;
