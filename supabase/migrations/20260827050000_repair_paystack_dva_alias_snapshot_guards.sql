-- Repair the Paystack alias guard interactions discovered after the initial
-- reservation hardening migration.
--
-- The payable snapshot trigger runs during an UPDATE of its source row. It
-- must mutate NEW rather than issue a second UPDATE against that same row.
-- The historical snapshot is promoted from paystack_version only after the
-- exact internal provider transition has been identified by the order guard.

CREATE OR REPLACE FUNCTION public.guard_order_paystack_dva_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_id uuid;
  v_needs_order_lock boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- version_active_paystack_alias_snapshot inserts a non-active
    -- paystack_version row and then promotes only its provider. The source
    -- alias is expired by the enclosing UPDATE's NEW value, so this exact
    -- internal transition must not reject the promotion as self-conflicting.
    IF OLD.provider = 'paystack_version'
      AND NEW.provider = 'paystack'
      AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id
      AND NEW.account_number IS NOT DISTINCT FROM OLD.account_number
      AND NEW.assigned_at IS NOT DISTINCT FROM OLD.assIGNED_AT
      AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at THEN
      RETURN NEW;
    END IF;
    -- Keep the current row out of conflict checks for lifecycle updates.
    v_current_id := OLD.id;
  END IF;

  -- Reservation acquires the order advisory lock before the order row lock.
  -- Terminal lifecycle updates already hold that row, so reacquiring the
  -- advisory lock here would invert the order and deadlock. Key-changing
  -- writes retain order-first serialization; expiry-only writes only need
  -- the account lock below.
  IF TG_OP = 'INSERT' THEN
    v_needs_order_lock := true;
  ELSE
    v_needs_order_lock :=
      NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.account_number IS DISTINCT FROM OLD.account_number
      OR NEW.provider IS DISTINCT FROM OLD.provider;
  END IF;

  IF v_needs_order_lock THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || NEW.order_id::text, 0)
    );
  END IF;

  IF NEW.provider <> 'paystack' THEN
    RETURN NEW;
  END IF;

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

CREATE OR REPLACE FUNCTION public.version_active_paystack_alias_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version_id uuid;
BEGIN
  IF OLD.provider <> 'paystack'
    OR NEW.payable_amount IS NOT DISTINCT FROM OLD.payable_amount
    OR COALESCE(
      OLD.expires_at,
      OLD.assigned_at + interval '90 minutes',
      OLD.created_at + interval '90 minutes'
    ) <= now() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || trim(OLD.account_number), 0
    )
  );

  INSERT INTO public.order_payment_accounts (
    order_id, account_number, bank_name, account_name, provider,
    payable_amount, assigned_at, expires_at, assignment_customer_email,
    assignment_customer_email_source
  ) VALUES (
    OLD.order_id, OLD.account_number, OLD.bank_name, OLD.account_name,
    'paystack_version', NEW.payable_amount, now(), OLD.expires_at,
    OLD.assignment_customer_email, OLD.assignment_customer_email_source
  ) RETURNING id INTO v_version_id;

  -- The source row will be expired through NEW when the enclosing UPDATE
  -- completes. The order guard allows only this exact paystack_version ->
  -- paystack transition while that enclosing row update is still in flight.
  UPDATE public.order_payment_accounts
  SET provider = 'paystack'
  WHERE id = v_version_id;

  NEW.payable_amount := OLD.payable_amount;
  NEW.assignment_customer_email := OLD.assignment_customer_email;
  NEW.expires_at := LEAST(COALESCE(NEW.expires_at, now()), now());
  RETURN NEW;
END;
$$;

-- Wallet aliases must be checked when an existing row becomes active or its
-- receiver changes, not only when the row is first inserted.
DROP TRIGGER IF EXISTS guard_wallet_paystack_dva_alias
  ON public.customer_wallet_payment_accounts;
CREATE TRIGGER guard_wallet_paystack_dva_alias
  BEFORE INSERT OR UPDATE OF provider, status, account_number
  ON public.customer_wallet_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_wallet_paystack_dva_alias();

REVOKE ALL ON FUNCTION public.guard_order_paystack_dva_alias() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.version_active_paystack_alias_snapshot()
  FROM PUBLIC;
