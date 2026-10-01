-- Allow expired Paystack assignments to remain available for late webhook
-- matching while serializing every raw order-account writer in reservation
-- lock order: order first, receiver second.

ALTER TABLE public.order_payment_accounts
  DROP CONSTRAINT IF EXISTS unique_order_account;

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
    pg_catalog.hashtextextended('baci_order_payment:' || NEW.order_id::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || trim(NEW.account_number), 0
    )
  );

  IF EXISTS (
    SELECT 1 FROM public.order_payment_accounts AS account
    WHERE account.order_id = NEW.order_id
      AND account.provider = 'paystack'
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

CREATE INDEX IF NOT EXISTS idx_order_payment_accounts_order_provider_expiry
  ON public.order_payment_accounts (order_id, provider, expires_at DESC);

REVOKE ALL ON FUNCTION public.guard_order_paystack_dva_alias() FROM PUBLIC;
