-- Enforce the pilot's merchant, supplier product and approved charge within
-- every worker RPC, including when a caller bypasses the operator script.
CREATE FUNCTION private.is_gift_card_petrock_pilot_order(
  p_order_id uuid, p_merchant_id uuid, p_product_id text, p_amount_kobo bigint
)
RETURNS boolean
LANGUAGE sql STABLE SET search_path TO ''
AS $$
  SELECT p_product_id = '2844' AND p_amount_kobo = 1673573
    AND EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = p_merchant_id AND m.slug = 'ogabassey'
    )
    AND p_order_id::text = (
      SELECT CASE WHEN count(*) = 1 THEN min(v.decrypted_secret) END
      FROM vault.decrypted_secrets v
      WHERE v.name = 'gift_card_petrock_pilot_order_id'
    )
$$;

REVOKE ALL ON FUNCTION private.is_gift_card_petrock_pilot_order(uuid, uuid, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role, gift_card_petrock_worker;

CREATE OR REPLACE FUNCTION public.read_gift_card_worker_order(p_id uuid)
RETURNS TABLE(id uuid, product_id text, amount_kobo bigint, status text, provider_order_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT o.id, o.product_id, o.amount_kobo, o.status, o.provider_order_id
  FROM public.gift_card_wallet_orders o
  WHERE o.id = p_id
    AND private.is_gift_card_petrock_pilot_order(o.id, o.merchant_id, o.product_id, o.amount_kobo)
$$;

CREATE OR REPLACE FUNCTION public.claim_gift_card_petrock_attempt(p_id uuid, p_product_id text, p_amount_kobo bigint)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$
  WITH attempt AS (
    UPDATE public.gift_card_wallet_orders o
       SET status = 'submitting', attempt_started_at = clock_timestamp()
     WHERE o.id = p_id
       AND private.is_gift_card_petrock_pilot_order(o.id, o.merchant_id, o.product_id, o.amount_kobo)
       AND o.product_id = p_product_id
       AND o.amount_kobo = p_amount_kobo AND o.status = 'paid'
       AND o.attempt_started_at IS NULL
    RETURNING o.id
  )
  SELECT EXISTS (SELECT 1 FROM attempt)
$$;

CREATE OR REPLACE FUNCTION public.record_gift_card_petrock_submission(p_id uuid, p_provider_id text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$
  WITH recorded AS (
    UPDATE public.gift_card_wallet_orders o
       SET status = CASE WHEN p_provider_id IS NULL THEN 'submission_unknown' ELSE 'submitted' END,
           provider_order_id = p_provider_id
     WHERE o.id = p_id
       AND private.is_gift_card_petrock_pilot_order(o.id, o.merchant_id, o.product_id, o.amount_kobo)
       AND o.status = 'submitting'
       AND (p_provider_id IS NULL OR p_provider_id ~ '^[A-Za-z0-9_-]{1,128}$')
    RETURNING o.id
  )
  SELECT EXISTS (SELECT 1 FROM recorded)
$$;

CREATE OR REPLACE FUNCTION public.capture_gift_card_petrock_result(
  p_id uuid, p_provider_id text, p_terminal_status text, p_sealed_replay text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_order public.gift_card_wallet_orders%ROWTYPE;
  v_wallet_id uuid;
  v_amount numeric;
  v_balance numeric;
BEGIN
  UPDATE public.gift_card_wallet_orders o
     SET provider_terminal_status = p_terminal_status,
         sealed_provider_replay = p_sealed_replay,
         provider_captured_at = clock_timestamp(),
         status = CASE WHEN p_terminal_status = 'reject' THEN 'refunded' ELSE 'fulfilled' END
   WHERE o.id = p_id
     AND private.is_gift_card_petrock_pilot_order(o.id, o.merchant_id, o.product_id, o.amount_kobo)
     AND o.status = 'submitted'
     AND o.provider_order_id = p_provider_id AND o.provider_captured_at IS NULL
     AND p_terminal_status IN ('success', 'reject')
     AND p_sealed_replay ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$'
  RETURNING o.* INTO v_order;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  IF p_terminal_status = 'success' THEN
    RETURN TRUE;
  END IF;

  SELECT t.wallet_id, t.amount INTO STRICT v_wallet_id, v_amount
    FROM public.customer_wallet_transactions t
   WHERE t.id = v_order.wallet_transaction_id
     AND t.merchant_id = v_order.merchant_id AND t.customer_id = v_order.customer_id
     AND t.source_type = 'gift_card_order' AND t.source_id = v_order.id
     AND t.type = 'redemption' AND t.status = 'completed'
     AND t.amount = v_order.amount_kobo / 100.0;

  UPDATE public.customer_wallets w
     SET available_balance = w.available_balance + v_amount,
         total_redeemed = greatest(coalesce(w.total_redeemed, 0) - v_amount, 0),
         updated_at = clock_timestamp()
   WHERE w.id = v_wallet_id AND w.merchant_id = v_order.merchant_id
     AND w.customer_id = v_order.customer_id AND w.available_balance IS NOT NULL
  RETURNING w.available_balance INTO STRICT v_balance;

  INSERT INTO public.customer_wallet_transactions
    (wallet_id, customer_id, merchant_id, type, amount, balance_after,
     source_type, source_id, status, description)
  VALUES
    (v_wallet_id, v_order.customer_id, v_order.merchant_id, 'refund', v_amount,
     v_balance, 'gift_card_order', v_order.id, 'completed', 'Gift card supplier rejection');

  RETURN TRUE;
END;
$$;
