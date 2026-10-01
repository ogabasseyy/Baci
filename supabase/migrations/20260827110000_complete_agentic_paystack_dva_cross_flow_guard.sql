-- Complete the serialized Paystack DVA guard for agentic checkout sessions.
--
-- The original guard checked order and wallet receivers but allowed two
-- merchants to reserve the same active checkout-session receiver.
CREATE OR REPLACE FUNCTION public.guard_agentic_paystack_dva_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.virtual_account_number IS NULL
    OR NEW.payment_provider IS DISTINCT FROM 'paystack'
    OR NEW.status NOT IN ('pending', 'processing')
    OR COALESCE(NEW.virtual_account_expires_at, NEW.expires_at) <= now() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || trim(NEW.virtual_account_number), 0
    )
  );

  IF EXISTS (
    SELECT 1 FROM public.order_payment_accounts AS account
    WHERE account.provider = 'paystack'
      AND account.account_number = trim(NEW.virtual_account_number)
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
  ) OR EXISTS (
    SELECT 1 FROM public.customer_wallet_payment_accounts AS wallet
    WHERE wallet.provider = 'paystack'
      AND wallet.account_number = trim(NEW.virtual_account_number)
      AND wallet.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.checkout_sessions AS checkout
    WHERE checkout.id IS DISTINCT FROM NEW.id
      AND checkout.virtual_account_number = trim(NEW.virtual_account_number)
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

REVOKE ALL ON FUNCTION public.guard_agentic_paystack_dva_alias() FROM PUBLIC;
