-- Serialize account ownership across order invoices, customer wallets, and
-- agentic checkout sessions. All three writers acquire the same account lock.

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

CREATE OR REPLACE FUNCTION public.guard_wallet_paystack_dva_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.provider <> 'paystack' OR NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || trim(NEW.account_number), 0
    )
  );

  IF EXISTS (
    SELECT 1 FROM public.order_payment_accounts AS account
    WHERE account.provider = 'paystack'
      AND account.account_number = trim(NEW.account_number)
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
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
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'PAYSTACK_DVA_ALIAS_CONFLICT';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_order_paystack_dva_alias
  ON public.order_payment_accounts;
CREATE TRIGGER guard_order_paystack_dva_alias
  BEFORE INSERT ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_paystack_dva_alias();

DROP TRIGGER IF EXISTS guard_wallet_paystack_dva_alias
  ON public.customer_wallet_payment_accounts;
CREATE TRIGGER guard_wallet_paystack_dva_alias
  BEFORE INSERT ON public.customer_wallet_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_wallet_paystack_dva_alias();

DROP TRIGGER IF EXISTS guard_agentic_paystack_dva_alias
  ON public.checkout_sessions;
CREATE TRIGGER guard_agentic_paystack_dva_alias
  BEFORE INSERT OR UPDATE OF virtual_account_number, payment_provider, status,
    virtual_account_expires_at, expires_at
  ON public.checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_agentic_paystack_dva_alias();

REVOKE ALL ON FUNCTION public.guard_order_paystack_dva_alias() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_wallet_paystack_dva_alias() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_agentic_paystack_dva_alias() FROM PUBLIC;
