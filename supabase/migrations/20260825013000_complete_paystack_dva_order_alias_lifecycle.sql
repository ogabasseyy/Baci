-- Complete order-to-order alias exclusion and release terminal-order aliases.

CREATE OR REPLACE FUNCTION public.guard_order_paystack_dva_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.provider <> 'paystack' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || trim(NEW.account_number), 0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.order_payment_accounts AS account
    JOIN public.orders AS orders ON orders.id = account.order_id
    WHERE account.provider = 'paystack'
      AND account.account_number = trim(NEW.account_number)
      AND account.order_id <> NEW.order_id
      AND orders.cancelled_at IS NULL
      AND orders.shipping_status NOT IN ('cancelled', 'canceled')
      AND orders.payment_status IN ('pending', 'unpaid', 'partially_paid')
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
  ) OR EXISTS (
    SELECT 1 FROM public.customer_wallet_payment_accounts AS wallet
    WHERE wallet.provider = 'paystack'
      AND wallet.account_number = trim(NEW.account_number)
      AND wallet.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.checkout_sessions AS checkout
    WHERE checkout.virtual_account_number = trim(NEW.account_number)
      AND checkout.payment_provider = 'paystack'
      AND checkout.status IN ('pending', 'processing')
      AND COALESCE(checkout.virtual_account_expires_at, checkout.expires_at) > now()
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'PAYSTACK_DVA_ALIAS_CONFLICT';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_terminal_order_paystack_dva_aliases()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.cancelled_at IS NOT NULL
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
  AFTER UPDATE OF payment_status, shipping_status, cancelled_at
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.expire_terminal_order_paystack_dva_aliases();

UPDATE public.order_payment_accounts AS account
SET expires_at = LEAST(COALESCE(account.expires_at, now()), now())
FROM public.orders AS orders
WHERE orders.id = account.order_id
  AND account.provider = 'paystack'
  AND COALESCE(account.expires_at, 'infinity'::timestamptz) > now()
  AND (
    orders.cancelled_at IS NOT NULL
    OR orders.shipping_status IN ('cancelled', 'canceled')
    OR orders.payment_status NOT IN ('pending', 'unpaid', 'partially_paid')
  );

REVOKE ALL ON FUNCTION public.expire_terminal_order_paystack_dva_aliases()
  FROM PUBLIC;
