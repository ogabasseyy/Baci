-- Apply the gift-card fixture and the gift-card migrations to a disposable database first.
BEGIN;
INSERT INTO public.merchants VALUES ('20000000-0000-4000-8000-000000000001', 'ogabassey');
INSERT INTO public.customers VALUES
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_wallet_transactions (id,wallet_id,customer_id,merchant_id)
VALUES ('40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
INSERT INTO public.gift_card_wallet_orders (id,merchant_id,customer_id,product_id,amount_kobo,wallet_transaction_id)
VALUES ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2844',1673573,'40000000-0000-4000-8000-000000000001');

DO $$
DECLARE v_order_id uuid := '50000000-0000-4000-8000-000000000001';
BEGIN
  IF has_function_privilege('authenticated', 'public.claim_gift_card_petrock_attempt(uuid,text,bigint)', 'EXECUTE')
     OR has_table_privilege('gift_card_petrock_worker', 'public.gift_card_wallet_orders', 'SELECT') THEN
    RAISE EXCEPTION 'worker privilege boundary is too broad';
  END IF;
  SET LOCAL ROLE gift_card_petrock_worker;
  IF public.claim_gift_card_petrock_attempt(v_order_id,'2844',1) THEN RAISE EXCEPTION 'Wrong amount claimed'; END IF;
  IF NOT public.claim_gift_card_petrock_attempt(v_order_id,'2844',1673573)
     OR public.claim_gift_card_petrock_attempt(v_order_id,'2844',1673573) THEN
    RAISE EXCEPTION 'Expected a single claim';
  END IF;
  IF NOT public.record_gift_card_petrock_submission(v_order_id,'supplier-1') THEN
    RAISE EXCEPTION 'Submission was not recorded';
  END IF;
  IF public.capture_gift_card_petrock_result(v_order_id,'other','success','v1.iv.tag.cipher')
     OR public.capture_gift_card_petrock_result(v_order_id,'supplier-1','success','voucher') THEN
    RAISE EXCEPTION 'Unexpected result capture';
  END IF;
  IF NOT public.capture_gift_card_petrock_result(v_order_id,'supplier-1','success','v1.iv.tag.cipher') THEN
    RAISE EXCEPTION 'Expected sealed evidence capture';
  END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.gift_card_wallet_orders o
    WHERE o.id = v_order_id AND o.provider_terminal_status = 'success'
      AND o.sealed_provider_replay = 'v1.iv.tag.cipher') THEN
    RAISE EXCEPTION 'Evidence was not stored';
  END IF;
END
$$;
ROLLBACK;

BEGIN;
INSERT INTO public.merchants VALUES ('20000000-0000-4000-8000-000000000001', 'ogabassey');
INSERT INTO public.customers VALUES
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance, total_redeemed)
VALUES ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 64.27, 16735.73);
INSERT INTO public.customer_wallet_transactions (id, wallet_id, customer_id, merchant_id, type, amount, source_type, source_id, status)
VALUES ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'redemption', 16735.73, 'gift_card_order', '50000000-0000-4000-8000-000000000001', 'completed');
INSERT INTO public.gift_card_wallet_orders (id, merchant_id, customer_id, product_id, amount_kobo, wallet_transaction_id, status, provider_order_id)
VALUES ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '2844', 1673573, '40000000-0000-4000-8000-000000000001', 'submitted', 'supplier-rejected');

DO $$
DECLARE v_order_id uuid := '50000000-0000-4000-8000-000000000001';
BEGIN
  SET LOCAL ROLE gift_card_petrock_worker;
  IF public.capture_gift_card_petrock_result(v_order_id, 'wrong-order', 'reject', 'v1.iv.tag.cipher') THEN
    RAISE EXCEPTION 'Wrong supplier ID accepted';
  END IF;
  IF NOT public.capture_gift_card_petrock_result(v_order_id, 'supplier-rejected', 'reject', 'v1.iv.tag.cipher')
     OR public.capture_gift_card_petrock_result(v_order_id, 'supplier-rejected', 'reject', 'v1.iv.tag.cipher') THEN
    RAISE EXCEPTION 'Expected one terminal capture';
  END IF;
  RESET ROLE;
  IF (SELECT status FROM public.gift_card_wallet_orders WHERE id = v_order_id) IS DISTINCT FROM 'refunded'
    OR (SELECT available_balance FROM public.customer_wallets) IS DISTINCT FROM 16800.00
    OR (SELECT total_redeemed FROM public.customer_wallets) IS DISTINCT FROM 0
    OR (SELECT count(*) FROM public.customer_wallet_transactions
          WHERE source_id = v_order_id AND type = 'refund' AND amount = 16735.73) <> 1 THEN
    RAISE EXCEPTION 'Expected one full wallet reversal';
  END IF;
END
$$;
ROLLBACK;
