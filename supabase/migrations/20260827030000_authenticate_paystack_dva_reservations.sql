-- Only the server that received a validated Paystack assignment may reserve
-- the account. The proof is short-lived, binds every persisted field, and is
-- checked before the existing atomic reservation path runs.

CREATE OR REPLACE FUNCTION public.paystack_dva_reservation_proof_valid(
  p_proof jsonb,
  p_order_id uuid,
  p_account_number text,
  p_bank_name text,
  p_account_name text,
  p_assigned_at timestamptz,
  p_expires_at timestamptz,
  p_customer_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account_name text := COALESCE(p_proof->>'account_name', '');
  v_account_number text := COALESCE(p_proof->>'account_number', '');
  v_assigned_at_text text := COALESCE(p_proof->>'assigned_at', '');
  v_assigned_at timestamptz;
  v_bank_name text := COALESCE(p_proof->>'bank_name', '');
  v_canonical text;
  v_customer_email text := COALESCE(p_proof->>'customer_email', '');
  v_expires_at_text text := COALESCE(p_proof->>'expires_at', '');
  v_expires_at timestamptz;
  v_issued_at text := COALESCE(p_proof->>'issued_at', '');
  v_issued_at_at timestamptz;
  v_order_id text := COALESCE(p_proof->>'order_id', '');
  v_secret text;
  v_signature text := COALESCE(p_proof->>'signature', '');
  v_expected_signature text;
  v_scope text := COALESCE(p_proof->>'scope', '');
  v_version text := COALESCE(p_proof->>'version', '');
BEGIN
  -- The application signer and database verifier both use the Supabase
  -- service-role key. Fail closed when the Vault entry is unavailable.
  IF pg_catalog.to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_secret
      USING 'service_role_key';
  END IF;

  IF p_proof IS NULL
    OR v_version <> 'paystack-dva-reservation:v1'
    OR v_scope <> 'paystack_dva_reservation'
    OR v_order_id <> COALESCE(p_order_id::text, '')
    OR v_account_number <> COALESCE(pg_catalog.btrim(p_account_number), '')
    OR v_bank_name <> COALESCE(pg_catalog.btrim(p_bank_name), '')
    OR v_account_name <> COALESCE(pg_catalog.btrim(p_account_name), '')
    OR v_customer_email <> lower(COALESCE(pg_catalog.btrim(p_customer_email), ''))
    OR v_signature !~ '^[0-9a-f]{64}$'
    OR v_issued_at = ''
    OR v_assigned_at_text = ''
    OR v_expires_at_text = ''
    OR v_secret IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_issued_at_at := v_issued_at::timestamptz;
    v_assigned_at := v_assigned_at_text::timestamptz;
    v_expires_at := v_expires_at_text::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  IF v_issued_at_at < pg_catalog.now() - INTERVAL '5 minutes'
    OR v_issued_at_at > pg_catalog.now() + INTERVAL '30 seconds'
    OR v_assigned_at IS DISTINCT FROM p_assigned_at
    OR v_expires_at IS DISTINCT FROM p_expires_at
    OR v_expires_at <= v_assigned_at THEN
    RETURN false;
  END IF;

  v_canonical := v_version || E'\n' || v_scope || E'\n' || v_order_id
    || E'\n' || v_customer_email || E'\n' || v_account_number
    || E'\n' || v_bank_name || E'\n' || v_account_name
    || E'\n' || v_assigned_at_text || E'\n' || v_expires_at_text
    || E'\n' || v_issued_at;
  v_expected_signature := pg_catalog.encode(
    extensions.hmac(v_canonical, v_secret, 'sha256'),
    'hex'
  );

  RETURN extensions.digest(v_signature, 'sha256') =
    extensions.digest(v_expected_signature, 'sha256');
END;
$$;

REVOKE ALL ON FUNCTION public.paystack_dva_reservation_proof_valid(
  jsonb, uuid, text, text, text, timestamptz, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_paystack_order_payment_account(
  p_order_id uuid,
  p_account_number text,
  p_bank_name text,
  p_account_name text,
  p_assigned_at timestamptz,
  p_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_internal_verified boolean :=
    pg_catalog.current_setting(
      'baci.paystack_dva_reservation_verified', true
    ) = 'on';
  v_normalized_account_number text := trim(p_account_number);
  v_merchant_id uuid;
  v_total numeric;
  v_amount_paid numeric;
  v_wallet_amount_used numeric;
  v_payment_status text;
  v_shipping_status text;
  v_cancelled_at timestamptz;
  v_transaction_paid numeric;
  v_wallet_transaction_paid numeric;
  v_savings_paid numeric;
  v_payable_amount numeric;
BEGIN
  IF (
    NOT v_internal_verified
    AND COALESCE(auth.uid(), NULL) IS NULL
    AND COALESCE(auth.role(), '') <> 'service_role'
  ) OR p_order_id IS NULL
    OR v_normalized_account_number = ''
    OR nullif(trim(p_bank_name), '') IS NULL
    OR nullif(trim(p_account_name), '') IS NULL
    OR p_assigned_at IS NULL OR p_expires_at IS NULL
    OR p_expires_at <= p_assigned_at THEN
    RAISE EXCEPTION 'invalid reservation request';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT orders.merchant_id, COALESCE(orders.total, 0),
    COALESCE(orders.amount_paid, 0), COALESCE(orders.wallet_amount_used, 0),
    orders.payment_status, orders.shipping_status, orders.cancelled_at
  INTO v_merchant_id, v_total, v_amount_paid, v_wallet_amount_used,
    v_payment_status, v_shipping_status, v_cancelled_at
  FROM public.orders AS orders
  WHERE orders.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR (
    NOT v_internal_verified
    AND COALESCE(auth.role(), '') <> 'service_role'
    AND NOT public.check_staff_permission(
      auth.uid(), v_merchant_id, 'orders', 'edit'
    )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    COALESCE(sum(COALESCE(transactions.amount, 0)), 0)::numeric,
    COALESCE(sum(COALESCE(transactions.amount, 0)) FILTER (
      WHERE lower(COALESCE(transactions.gateway, '')) IN ('wallet', 'store_credit')
    ), 0)::numeric
  INTO v_transaction_paid, v_wallet_transaction_paid
  FROM public.transactions AS transactions
  WHERE transactions.order_id = p_order_id
    AND transactions.merchant_id = v_merchant_id
    AND transactions.transaction_type = 'payment'
    AND transactions.status IN ('success', 'completed');

  SELECT COALESCE(sum(COALESCE(redemptions.amount, 0)), 0)::numeric
  INTO v_savings_paid
  FROM public.customer_savings_redemptions AS redemptions
  WHERE redemptions.order_id = p_order_id
    AND redemptions.merchant_id = v_merchant_id
    AND redemptions.metadata ->> 'reversed_at' IS NULL;

  v_payable_amount := greatest(
    v_total - greatest(
      v_amount_paid,
      v_transaction_paid + greatest(
        0,
        v_wallet_amount_used - v_wallet_transaction_paid
      ) + v_savings_paid
    ),
    0
  );

  IF v_cancelled_at IS NOT NULL
    OR v_shipping_status IN ('cancelled', 'canceled')
    OR v_payment_status NOT IN ('pending', 'unpaid', 'partially_paid')
    OR v_payable_amount <= 0 THEN
    RETURN 'ineligible';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || v_normalized_account_number,
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.customer_wallet_payment_accounts AS wallet_account
    WHERE wallet_account.provider = 'paystack'
      AND wallet_account.account_number = v_normalized_account_number
      AND wallet_account.status = 'active'
  ) THEN
    RETURN 'wallet_conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_payment_accounts AS account
    WHERE account.order_id = p_order_id
      AND account.provider = 'paystack'
      AND account.account_number = v_normalized_account_number
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
  ) THEN
    UPDATE public.order_payment_accounts AS account
    SET expires_at = GREATEST(
      COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes',
        now()
      ),
      p_expires_at
    )
    WHERE account.order_id = p_order_id
      AND account.provider = 'paystack'
      AND account.account_number = v_normalized_account_number
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now();
    RETURN 'existing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_payment_accounts AS account
    WHERE account.provider = 'paystack'
      AND account.account_number = v_normalized_account_number
      AND account.order_id <> p_order_id
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
  ) THEN
    RETURN 'conflict';
  END IF;

  INSERT INTO public.order_payment_accounts (
    order_id, account_number, bank_name, account_name, provider,
    payable_amount, assigned_at, expires_at
  ) VALUES (
    p_order_id, v_normalized_account_number, trim(p_bank_name),
    trim(p_account_name), 'paystack', v_payable_amount,
    p_assigned_at, p_expires_at
  );

  RETURN 'inserted';
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_paystack_order_payment_account(
  uuid, text, text, text, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_paystack_order_payment_account(
  uuid, text, text, text, timestamptz, timestamptz
) TO service_role;
