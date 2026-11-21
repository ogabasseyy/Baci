-- Only owner-controlled settlement functions can credit the original wallet.
CREATE FUNCTION private.credit_gift_card_wallet_refund(
  v_order public.gift_card_wallet_orders, p_description text
)
RETURNS void
LANGUAGE plpgsql SET search_path TO ''
AS $$
DECLARE
  v_wallet_id uuid;
  v_amount numeric;
  v_balance numeric;
BEGIN
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
     v_balance, 'gift_card_order', v_order.id, 'completed', p_description);

END;
$$;

REVOKE ALL ON FUNCTION private.credit_gift_card_wallet_refund(public.gift_card_wallet_orders, text)
  FROM PUBLIC, anon, authenticated, service_role, gift_card_petrock_worker;

CREATE OR REPLACE FUNCTION public.capture_gift_card_petrock_result(
  p_id uuid, p_provider_id text, p_terminal_status text, p_sealed_replay text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_order public.gift_card_wallet_orders%ROWTYPE;
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

  PERFORM private.credit_gift_card_wallet_refund(v_order, 'Gift card supplier rejection');

  RETURN TRUE;
END;
$$;

ALTER TABLE public.gift_card_wallet_orders ADD COLUMN nonplacement_receipt text;

-- The database owner must establish non-placement before invoking this
-- for an attempted order. The Petrock worker cannot invoke this function.
CREATE FUNCTION private.refund_unplaced_gift_card_pilot_order(
  p_id uuid, p_nonplacement_receipt text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SET search_path TO ''
AS $$
DECLARE
  v_order public.gift_card_wallet_orders%ROWTYPE;
BEGIN
  UPDATE public.gift_card_wallet_orders o
     SET status = 'refunded', nonplacement_receipt = p_nonplacement_receipt
   WHERE o.id = p_id
     AND private.is_gift_card_petrock_pilot_order(o.id, o.merchant_id, o.product_id, o.amount_kobo)
     AND o.provider_order_id IS NULL AND o.provider_captured_at IS NULL
     AND (
       (o.status = 'paid' AND o.attempt_started_at IS NULL AND p_nonplacement_receipt IS NULL)
       OR (
         o.status = 'submission_unknown' AND o.attempt_started_at IS NOT NULL
         AND p_nonplacement_receipt ~ '^[A-Za-z0-9_-]{1,80}$'
       )
     )
  RETURNING o.* INTO v_order;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  PERFORM private.credit_gift_card_wallet_refund(
    v_order,
    CASE WHEN p_nonplacement_receipt IS NULL THEN 'Gift card canceled before submission'
      ELSE 'Gift card supplier non-placement confirmed'
    END
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION private.refund_unplaced_gift_card_pilot_order(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, gift_card_petrock_worker;
