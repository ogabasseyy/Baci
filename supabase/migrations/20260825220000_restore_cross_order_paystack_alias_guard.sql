-- The primary insert guard already holds the order and receiver advisory locks.
-- Restore the cross-order receiver exclusion after allowing expired history rows.

CREATE OR REPLACE FUNCTION public.reject_cross_order_paystack_dva_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.provider = 'paystack' AND EXISTS (
    SELECT 1 FROM public.order_payment_accounts AS account
    WHERE account.order_id <> NEW.order_id
      AND account.provider = 'paystack'
      AND account.account_number = trim(NEW.account_number)
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'PAYSTACK_DVA_ALIAS_CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS z_reject_cross_order_paystack_dva_alias
  ON public.order_payment_accounts;
CREATE TRIGGER z_reject_cross_order_paystack_dva_alias
  BEFORE INSERT ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.reject_cross_order_paystack_dva_alias();

REVOKE ALL ON FUNCTION public.reject_cross_order_paystack_dva_alias()
  FROM PUBLIC;
