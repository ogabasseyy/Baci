-- Preserve expired aliases for late webhook matching and treat email-only case
-- or surrounding whitespace changes as the same Paystack customer identity.

CREATE OR REPLACE FUNCTION public.release_expired_paystack_order_account(
  p_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'invalid release request';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  SELECT orders.merchant_id INTO v_merchant_id
  FROM public.orders AS orders WHERE orders.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT public.check_staff_permission(
    auth.uid(), v_merchant_id, 'orders', 'edit'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM public.order_payment_accounts AS account
    WHERE account.order_id = p_order_id
      AND account.provider = 'paystack'
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_terminal_order_paystack_dva_aliases()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF lower(trim(NEW.customer_email)) IS DISTINCT FROM lower(trim(OLD.customer_email))
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
