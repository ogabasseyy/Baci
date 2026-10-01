-- Keep stored alias expiry aligned with the webhook window and allow an
-- eligible order to release its expired row before safe reprovisioning.

CREATE OR REPLACE FUNCTION public.clamp_paystack_order_alias_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_window_end timestamptz;
BEGIN
  IF NEW.provider <> 'paystack' THEN
    RETURN NEW;
  END IF;

  v_window_end := COALESCE(NEW.assigned_at, NEW.created_at, now())
    + interval '90 minutes';
  NEW.expires_at := LEAST(COALESCE(NEW.expires_at, v_window_end), v_window_end);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_clamp_paystack_order_alias_expiry
  ON public.order_payment_accounts;
CREATE TRIGGER a_clamp_paystack_order_alias_expiry
  BEFORE INSERT OR UPDATE OF provider, assigned_at, created_at, expires_at
  ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.clamp_paystack_order_alias_expiry();

UPDATE public.order_payment_accounts AS account
SET expires_at = LEAST(
  COALESCE(
    account.expires_at,
    COALESCE(account.assigned_at, account.created_at) + interval '90 minutes'
  ),
  COALESCE(account.assigned_at, account.created_at) + interval '90 minutes'
)
WHERE account.provider = 'paystack'
  AND COALESCE(account.assigned_at, account.created_at) IS NOT NULL
  AND account.expires_at IS DISTINCT FROM LEAST(
    COALESCE(
      account.expires_at,
      COALESCE(account.assigned_at, account.created_at) + interval '90 minutes'
    ),
    COALESCE(account.assigned_at, account.created_at) + interval '90 minutes'
  );

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
  FROM public.orders AS orders
  WHERE orders.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.check_staff_permission(
    auth.uid(), v_merchant_id, 'orders', 'edit'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM public.order_payment_accounts AS account
  WHERE account.order_id = p_order_id
    AND account.provider = 'paystack'
    AND LEAST(
      COALESCE(account.expires_at, 'infinity'::timestamptz),
      COALESCE(account.assigned_at, account.created_at) + interval '90 minutes'
    ) <= now();

  RETURN NOT EXISTS (
    SELECT 1 FROM public.order_payment_accounts AS account
    WHERE account.order_id = p_order_id AND account.provider = 'paystack'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_expired_paystack_order_account(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_expired_paystack_order_account(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.clamp_paystack_order_alias_expiry() FROM PUBLIC;
