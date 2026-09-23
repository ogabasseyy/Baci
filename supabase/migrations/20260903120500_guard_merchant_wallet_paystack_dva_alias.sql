-- Include merchant-wallet Paystack receivers in the shared DVA alias lock.
-- Order, customer-wallet, and agentic writers already serialize on
-- paystack_order_account:<number>; merchant-wallet persistence did not, so an
-- overlapping assignment could steal a reserved customer/order receiver.

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
    IF OLD.provider = 'paystack_version'
      AND NEW.provider = 'paystack'
      AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id
      AND NEW.account_number IS NOT DISTINCT FROM OLD.account_number
      AND NEW.assigned_at IS NOT DISTINCT FROM OLD.assigned_at
      AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at THEN
      RETURN NEW;
    END IF;
    v_current_id := OLD.id;
  END IF;

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
    SELECT 1 FROM public.merchant_wallet_payment_accounts AS merchant_wallet
    WHERE merchant_wallet.provider = 'paystack'
      AND merchant_wallet.account_number = trim(NEW.account_number)
      AND merchant_wallet.status = 'active'
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
    SELECT 1 FROM public.merchant_wallet_payment_accounts AS merchant_wallet
    WHERE merchant_wallet.provider = 'paystack'
      AND merchant_wallet.account_number = trim(NEW.account_number)
      AND merchant_wallet.status = 'active'
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
  ) OR EXISTS (
    SELECT 1 FROM public.merchant_wallet_payment_accounts AS merchant_wallet
    WHERE merchant_wallet.provider = 'paystack'
      AND merchant_wallet.account_number = trim(NEW.virtual_account_number)
      AND merchant_wallet.status = 'active'
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

CREATE OR REPLACE FUNCTION public.guard_merchant_wallet_paystack_dva_alias()
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

DROP TRIGGER IF EXISTS guard_merchant_wallet_paystack_dva_alias
  ON public.merchant_wallet_payment_accounts;
CREATE TRIGGER guard_merchant_wallet_paystack_dva_alias
  BEFORE INSERT OR UPDATE OF provider, status, account_number
  ON public.merchant_wallet_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_merchant_wallet_paystack_dva_alias();

CREATE OR REPLACE FUNCTION public.persist_merchant_wallet_payment_account(
  p_request_id uuid,
  p_merchant_id uuid,
  p_account_number text,
  p_account_name text,
  p_bank_name text,
  p_currency text,
  p_provider_account_id text DEFAULT NULL,
  p_provider_customer_code text DEFAULT NULL
)
RETURNS public.merchant_wallet_payment_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.merchant_wallet_payment_accounts;
  v_request public.merchant_wallet_funding_account_requests;
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_currency <> 'NGN' OR p_account_number !~ '^[0-9]{10,20}$' THEN
    RAISE EXCEPTION 'invalid_account' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_request
  FROM public.merchant_wallet_funding_account_requests
  WHERE id = p_request_id AND merchant_id = p_merchant_id
  FOR UPDATE;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'funding_request_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_request.status = 'fulfilled' THEN
    SELECT * INTO v_row
    FROM public.merchant_wallet_payment_accounts
    WHERE request_id = p_request_id;
    IF v_row.account_number = p_account_number
      AND v_row.account_name IS NOT DISTINCT FROM p_account_name
      AND v_row.bank_name IS NOT DISTINCT FROM p_bank_name
      AND v_row.currency = p_currency
      AND v_row.provider_account_id IS NOT DISTINCT FROM p_provider_account_id
      AND v_row.provider_customer_code IS NOT DISTINCT FROM p_provider_customer_code THEN
      RETURN v_row;
    END IF;
    RAISE EXCEPTION 'conflicting_assignment_replay' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || trim(p_account_number), 0
    )
  );
  IF EXISTS (
    SELECT 1 FROM public.order_payment_accounts AS account
    WHERE account.provider = 'paystack'
      AND account.account_number = trim(p_account_number)
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
  ) OR EXISTS (
    SELECT 1 FROM public.customer_wallet_payment_accounts AS wallet
    WHERE wallet.provider = 'paystack'
      AND wallet.account_number = trim(p_account_number)
      AND wallet.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.checkout_sessions AS checkout
    WHERE checkout.virtual_account_number = trim(p_account_number)
      AND checkout.payment_provider = 'paystack'
      AND checkout.status IN ('pending', 'processing')
      AND COALESCE(checkout.virtual_account_expires_at, checkout.expires_at) > now()
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'PAYSTACK_DVA_ALIAS_CONFLICT';
  END IF;

  INSERT INTO public.merchant_wallet_payment_accounts (
    merchant_id, request_id, account_number, account_name, bank_name, currency,
    status, provider_account_id, provider_customer_code
  ) VALUES (
    p_merchant_id, p_request_id, p_account_number, p_account_name, p_bank_name,
    'NGN', 'active', p_provider_account_id, p_provider_customer_code
  )
  ON CONFLICT (merchant_id, provider) WHERE status IN ('active', 'pending')
  DO UPDATE SET
    request_id = EXCLUDED.request_id,
    account_number = EXCLUDED.account_number,
    account_name = EXCLUDED.account_name,
    bank_name = EXCLUDED.bank_name,
    provider_account_id = EXCLUDED.provider_account_id,
    provider_customer_code = EXCLUDED.provider_customer_code,
    status = 'active',
    updated_at = now()
  RETURNING * INTO v_row;
  UPDATE public.merchant_wallet_funding_account_requests
  SET status = 'fulfilled'
  WHERE id = p_request_id AND merchant_id = p_merchant_id AND status = 'pending';
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_order_paystack_dva_alias() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_wallet_paystack_dva_alias() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_agentic_paystack_dva_alias() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_merchant_wallet_paystack_dva_alias() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_merchant_wallet_payment_account(uuid, uuid, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_merchant_wallet_payment_account(uuid, uuid, text, text, text, text, text, text)
  TO service_role;
