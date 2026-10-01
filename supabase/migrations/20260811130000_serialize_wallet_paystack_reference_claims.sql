-- Claim wallet DVA Paystack references through the same reference-keyed
-- advisory lock used by order and manual reconciliation paths. A direct
-- client-side transactions insert cannot see an uncommitted competing claim.

CREATE OR REPLACE FUNCTION public.claim_paystack_wallet_dva_transaction(
  p_merchant_id uuid,
  p_amount numeric,
  p_currency text,
  p_reference text,
  p_metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reference text := trim(COALESCE(p_reference, ''));
  v_existing_id uuid;
  v_existing_merchant_id uuid;
  v_existing_order_id uuid;
  v_existing_transaction_type text;
  v_transaction_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: claim_paystack_wallet_dva_transaction requires service_role';
  END IF;
  IF p_merchant_id IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR NULLIF(v_reference, '') IS NULL
     OR lower(trim(COALESCE(p_currency, 'NGN'))) <> 'ngn' THEN
    RAISE EXCEPTION 'invalid_wallet_dva_transaction_arguments';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_reference, 0)
  );

  SELECT t.id, t.merchant_id, t.order_id,
         t.metadata ->> 'transaction_type'
    INTO v_existing_id, v_existing_merchant_id, v_existing_order_id,
         v_existing_transaction_type
    FROM public.transactions AS t
   WHERE lower(trim(COALESCE(t.gateway, ''))) = 'paystack'
     AND t.gateway_reference = v_reference
   FOR UPDATE;
  IF v_existing_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public.transactions AS conflicting
       WHERE lower(trim(COALESCE(conflicting.gateway, ''))) = 'paystack'
         AND conflicting.gateway_reference = v_reference
         AND (
           conflicting.merchant_id IS DISTINCT FROM p_merchant_id
           OR conflicting.order_id IS NOT NULL
           OR conflicting.metadata ->> 'transaction_type' IS DISTINCT FROM 'wallet_topup'
         )
    ) THEN
      RAISE EXCEPTION 'paystack_reference_already_recorded';
    END IF;
    IF v_existing_merchant_id IS DISTINCT FROM p_merchant_id
       OR v_existing_order_id IS NOT NULL
       OR v_existing_transaction_type IS DISTINCT FROM 'wallet_topup' THEN
      RAISE EXCEPTION 'paystack_reference_already_recorded';
    END IF;
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.transactions (
    merchant_id, order_id, transaction_type, amount, currency, status, gateway,
    gateway_reference, platform_fee, merchant_amount, description, metadata
  ) VALUES (
    p_merchant_id, NULL, 'payment', p_amount, 'NGN', 'pending', 'paystack',
    v_reference, 0, 0, 'Customer wallet top-up via Paystack DVA',
    COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_transaction_id;

  RETURN v_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_paystack_wallet_dva_transaction(
  uuid, numeric, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_paystack_wallet_dva_transaction(
  uuid, numeric, text, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.claim_paystack_wallet_dva_transaction(
  uuid, numeric, text, text, jsonb
) IS
  'Atomically claims a Paystack wallet-DVA reference under the shared reference advisory lock and returns its pending transaction id.';
