-- Release loyalty claims when their order cancels (issue #3165).
--
-- Claim linkage is reward_redemptions.used_on_order_id, stamped by the
-- checkout bridge. Every cancel path funnels through
-- orders.shipping_status = 'cancelled' (customer, merchant, and
-- inventory-release RPCs), so one trigger restores the code without
-- touching points (spent at redeem; the code simply becomes spendable
-- again) or stock (consumed at redeem, not at claim).
CREATE OR REPLACE FUNCTION public.release_loyalty_claims_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.shipping_status = 'cancelled'
     AND OLD.shipping_status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.reward_redemptions
    SET used = false, used_on_order_id = NULL, used_at = NULL
    WHERE used_on_order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS release_loyalty_claims_on_order_cancel ON public.orders;
CREATE TRIGGER release_loyalty_claims_on_order_cancel
  AFTER UPDATE OF shipping_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.release_loyalty_claims_on_order_cancel();

-- The trigger's release lookup must not seq-scan redemptions per cancel.
CREATE INDEX IF NOT EXISTS loyalty_claim_release_order_idx
  ON public.reward_redemptions (used_on_order_id)
  WHERE used_on_order_id IS NOT NULL;
