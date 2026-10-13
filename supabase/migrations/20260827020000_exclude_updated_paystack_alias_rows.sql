-- UPDATE triggers must ignore the row being changed when checking for an
-- alias conflict. Otherwise an expiry or ownership update sees OLD as an
-- active conflicting row and rejects its own lifecycle transition.

CREATE OR REPLACE FUNCTION public.guard_order_paystack_dva_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_current_id := OLD.id;
  END IF;

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
    WHERE account.id IS DISTINCT FROM v_current_id
      AND account.order_id = NEW.order_id
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

CREATE OR REPLACE FUNCTION public.reject_cross_order_paystack_dva_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_current_id := OLD.id;
  END IF;

  IF NEW.provider = 'paystack' AND EXISTS (
    SELECT 1 FROM public.order_payment_accounts AS account
    WHERE account.id IS DISTINCT FROM v_current_id
      AND account.order_id <> NEW.order_id
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

REVOKE ALL ON FUNCTION public.guard_order_paystack_dva_alias() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_cross_order_paystack_dva_alias()
  FROM PUBLIC;
