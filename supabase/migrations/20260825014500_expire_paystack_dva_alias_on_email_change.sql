-- A Paystack DVA belongs to the customer email used during provisioning. Retire
-- it when that matching key changes so the next receipt safely reprovisions.

CREATE OR REPLACE FUNCTION public.expire_terminal_order_paystack_dva_aliases()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.customer_email IS DISTINCT FROM OLD.customer_email
    OR NEW.cancelled_at IS NOT NULL
    OR NEW.shipping_status IN ('cancelled', 'canceled')
    OR NEW.payment_status NOT IN ('pending', 'unpaid', 'partially_paid') THEN
    UPDATE public.order_payment_accounts AS account
    SET expires_at = LEAST(COALESCE(account.expires_at, now()), now())
    WHERE account.order_id = NEW.id
      AND account.provider = 'paystack'
      AND COALESCE(account.expires_at, 'infinity'::timestamptz) > now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expire_terminal_order_paystack_dva_aliases
  ON public.orders;
CREATE TRIGGER expire_terminal_order_paystack_dva_aliases
  AFTER UPDATE OF payment_status, shipping_status, cancelled_at, customer_email
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.expire_terminal_order_paystack_dva_aliases();

REVOKE ALL ON FUNCTION public.expire_terminal_order_paystack_dva_aliases()
  FROM PUBLIC;
