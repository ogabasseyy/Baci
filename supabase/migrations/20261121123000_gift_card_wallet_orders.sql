CREATE TABLE public.gift_card_wallet_orders (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  product_id text NOT NULL CHECK (product_id ~ '^[0-9]{1,16}$'),
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9999999999),
  wallet_transaction_id uuid NOT NULL UNIQUE REFERENCES public.customer_wallet_transactions(id),
  status text NOT NULL DEFAULT 'paid' CHECK (status IN
    ('paid', 'submitting', 'submitted', 'submission_unknown', 'fulfilled', 'refunded')),
  provider_order_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gift_card_wallet_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gift_card_wallet_orders FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.confirm_gift_card_wallet_quote(p_payload text, p_signature text)
RETURNS TABLE(order_id uuid, order_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_quote jsonb;
  v_secret text;
  v_id uuid;
  v_merchant uuid;
  v_customer uuid;
  v_product text;
  v_amount bigint;
  v_expires bigint;
  v_wallet uuid;
  v_balance numeric;
  v_existing public.gift_card_wallet_orders%ROWTYPE;
  v_ledger uuid;
  v_now_ms bigint;
BEGIN
  IF v_user IS NULL OR p_payload IS NULL OR length(p_payload) > 1024
     OR p_signature IS NULL OR p_signature !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_gift_card_quote' USING ERRCODE = '22023';
  END IF;

  SELECT decrypted_secret INTO STRICT v_secret
    FROM vault.decrypted_secrets WHERE name = 'gift_card_wallet_quote_hmac';
  IF length(v_secret) < 32 OR extensions.digest(p_signature, 'sha256') IS DISTINCT FROM
     extensions.digest(encode(extensions.hmac('baci:gift-card-wallet:v1' || E'\n' || p_payload,
       v_secret, 'sha256'), 'hex'), 'sha256') THEN
    RAISE EXCEPTION 'invalid_gift_card_quote' USING ERRCODE = '22023';
  END IF;

  v_quote := p_payload::jsonb;
  v_id := (v_quote->>'id')::uuid;
  v_merchant := (v_quote->>'merchantId')::uuid;
  v_product := v_quote->>'cardId';
  v_amount := (v_quote->>'totalKobo')::bigint;
  v_expires := (v_quote->>'expiresAt')::bigint;
  IF (v_quote->>'userId')::uuid IS DISTINCT FROM v_user
     OR v_id IS NULL OR v_merchant IS NULL OR v_product IS NULL
     OR v_product !~ '^[0-9]{1,16}$' OR v_amount IS NULL
     OR v_amount NOT BETWEEN 1 AND 9999999999 OR v_expires IS NULL THEN
    RAISE EXCEPTION 'invalid_gift_card_quote' USING ERRCODE = '22023';
  END IF;

  SELECT c.id INTO STRICT v_customer
  FROM public.customers c
  JOIN public.merchants m ON m.id = c.merchant_id
  WHERE c.user_id = v_user AND c.merchant_id = v_merchant AND m.slug = 'ogabassey'
  FOR SHARE OF c, m;

  SELECT w.id, w.available_balance INTO STRICT v_wallet, v_balance
  FROM public.customer_wallets w
  WHERE w.customer_id = v_customer AND w.merchant_id = v_merchant
  FOR UPDATE;

  SELECT o.* INTO v_existing FROM public.gift_card_wallet_orders o WHERE o.id = v_id;
  IF FOUND THEN
    IF v_existing.customer_id <> v_customer OR v_existing.merchant_id <> v_merchant
       OR v_existing.product_id <> v_product OR v_existing.amount_kobo <> v_amount THEN
      RAISE EXCEPTION 'invalid_gift_card_quote' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.status;
    RETURN;
  END IF;

  v_now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF v_expires <= v_now_ms OR v_expires > v_now_ms + 60000 THEN
    RAISE EXCEPTION 'expired_gift_card_quote' USING ERRCODE = '22023';
  END IF;
  IF v_balance IS NULL OR v_balance < v_amount / 100.0 THEN
    RAISE EXCEPTION 'insufficient_wallet_balance' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.customer_wallets
     SET available_balance = available_balance - v_amount / 100.0,
         total_redeemed = coalesce(total_redeemed, 0) + v_amount / 100.0,
         updated_at = now()
   WHERE id = v_wallet
   RETURNING available_balance INTO v_balance;

  INSERT INTO public.customer_wallet_transactions
    (wallet_id, customer_id, merchant_id, type, amount, balance_after,
     source_type, source_id, status, description)
  VALUES
    (v_wallet, v_customer, v_merchant, 'redemption', v_amount / 100.0, v_balance,
     'gift_card_order', v_id, 'completed', 'Gift card purchase')
  RETURNING id INTO v_ledger;

  INSERT INTO public.gift_card_wallet_orders
    (id, merchant_id, customer_id, product_id, amount_kobo, wallet_transaction_id)
  VALUES (v_id, v_merchant, v_customer, v_product, v_amount, v_ledger);
  RETURN QUERY SELECT v_id, 'paid'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_gift_card_wallet_quote(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_gift_card_wallet_quote(text, text)
  TO authenticated;
