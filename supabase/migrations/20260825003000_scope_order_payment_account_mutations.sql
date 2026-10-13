-- Replace the broad row UPDATE policy with two least-privilege RPCs. The
-- reservation RPC serializes on the provider account number so aliases cannot
-- overlap across orders or merchants.

DROP POLICY IF EXISTS owners_and_staff_update_order_payment_accounts
  ON public.order_payment_accounts;

CREATE OR REPLACE FUNCTION public.refresh_paystack_order_payable_amount(
  p_order_id uuid,
  p_payable_amount numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_order_id IS NULL OR p_payable_amount IS NULL
    OR p_payable_amount < 0 THEN
    RAISE EXCEPTION 'invalid refresh request';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders AS orders
    WHERE orders.id = p_order_id
      AND public.has_merchant_access(orders.merchant_id)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.order_payment_accounts AS account
  SET payable_amount = p_payable_amount
  WHERE account.order_id = p_order_id
    AND account.provider = 'paystack';

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_paystack_order_payable_amount(uuid, numeric)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_paystack_order_payable_amount(uuid, numeric)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.reserve_paystack_order_payment_account(
  p_order_id uuid,
  p_account_number text,
  p_bank_name text,
  p_account_name text,
  p_payable_amount numeric,
  p_assigned_at timestamptz,
  p_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_normalized_account_number text := trim(p_account_number);
BEGIN
  IF auth.uid() IS NULL OR p_order_id IS NULL
    OR v_normalized_account_number = ''
    OR nullif(trim(p_bank_name), '') IS NULL
    OR nullif(trim(p_account_name), '') IS NULL
    OR p_payable_amount IS NULL OR p_payable_amount <= 0
    OR p_assigned_at IS NULL OR p_expires_at IS NULL
    OR p_expires_at <= p_assigned_at THEN
    RAISE EXCEPTION 'invalid reservation request';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders AS orders
    WHERE orders.id = p_order_id
      AND public.has_merchant_access(orders.merchant_id)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || v_normalized_account_number,
      0
    )
  );

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
    order_id,
    account_number,
    bank_name,
    account_name,
    provider,
    payable_amount,
    assigned_at,
    expires_at
  ) VALUES (
    p_order_id,
    v_normalized_account_number,
    trim(p_bank_name),
    trim(p_account_name),
    'paystack',
    p_payable_amount,
    p_assigned_at,
    p_expires_at
  );

  RETURN 'inserted';
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_paystack_order_payment_account(
  uuid, text, text, text, numeric, timestamptz, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_paystack_order_payment_account(
  uuid, text, text, text, numeric, timestamptz, timestamptz
) TO authenticated;
