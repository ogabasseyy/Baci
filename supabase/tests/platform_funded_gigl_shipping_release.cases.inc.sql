-- Cases for platform_funded_gigl_shipping_release.sql (\ir part).

-- T1: cancelling the order releases the platform reservation, no wallet credit.
DO $t1$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000001';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000001';
  v_charge uuid;
  v_before numeric := pg_temp.wallet_balance(v_merchant);
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  v_charge := pg_temp.seed_platform_charge(v_merchant, 1, 'tok-1');
  UPDATE public.orders SET shipping_status = 'cancelled' WHERE id = v_order;
  SELECT * INTO v_row FROM public.merchant_shipping_charges WHERE id = v_charge;
  IF v_row.status IS DISTINCT FROM 'refunded' OR v_row.refund_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'T1: cancel must refund the platform charge without a wallet refund (status %, refund tx %)',
      v_row.status, v_row.refund_transaction_id;
  END IF;
  IF pg_temp.wallet_balance(v_merchant) IS DISTINCT FROM v_before
     OR pg_temp.wallet_tx_count(v_order) <> 0 THEN
    RAISE EXCEPTION 'T1: cancelling a platform reservation must not move the wallet';
  END IF;
END;
$t1$;

-- T2: self-fulfilment releases the platform reservation, no wallet credit.
DO $t2$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000001';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000002';
  v_charge uuid;
  v_before numeric := pg_temp.wallet_balance(v_merchant);
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  v_charge := pg_temp.seed_platform_charge(v_merchant, 2, 'tok-2');
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000001');
  PERFORM public.self_fulfill_order_with_wallet_release(
    v_order, '{"method":"self"}'::jsonb, 'Self-Delivery', NULL
  );
  SELECT * INTO v_row FROM public.merchant_shipping_charges WHERE id = v_charge;
  IF v_row.status IS DISTINCT FROM 'refunded' OR v_row.refund_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'T2: self-fulfil must refund the platform charge without a wallet refund (status %)', v_row.status;
  END IF;
  IF pg_temp.wallet_balance(v_merchant) IS DISTINCT FROM v_before
     OR pg_temp.wallet_tx_count(v_order) <> 0 THEN
    RAISE EXCEPTION 'T2: self-fulfilling a platform reservation must not move the wallet';
  END IF;
END;
$t2$;

-- T3: the refund RPC credits nothing back for a platform charge.
DO $t3$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000001';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000003';
  v_charge uuid;
  v_before numeric := pg_temp.wallet_balance(v_merchant);
  v_result text;
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  v_charge := pg_temp.seed_platform_charge(v_merchant, 3, 'tok-3');
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000001');
  v_result := public.refund_merchant_shipping_charge(v_charge, 'tok-3', 'TEST');
  SELECT * INTO v_row FROM public.merchant_shipping_charges WHERE id = v_charge;
  IF v_result IS DISTINCT FROM 'refunded' OR v_row.status IS DISTINCT FROM 'refunded'
     OR v_row.refund_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'T3: refund RPC must mark the platform charge refunded without a wallet refund';
  END IF;
  IF pg_temp.wallet_balance(v_merchant) IS DISTINCT FROM v_before
     OR pg_temp.wallet_tx_count(v_order) <> 0 THEN
    RAISE EXCEPTION 'T3: refunding a platform charge must not move the wallet';
  END IF;
END;
$t3$;

-- T4: a flagged merchant's reserve records a platform charge and debits nothing.
DO $t4$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000001';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000004';
  v_quote constant uuid := 'b4c13000-0000-4000-8000-000000000004';
  v_before numeric;
  v_result record;
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  -- Zero wallet: Baci pays, so a flagged merchant needs no spendable funds.
  UPDATE public.merchant_wallets SET available_balance = 0 WHERE merchant_id = v_merchant;
  v_before := pg_temp.wallet_balance(v_merchant);
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000001');
  SELECT * INTO v_result FROM public.reserve_merchant_shipping_charge(v_order, v_quote, 'tok-4');
  SELECT * INTO v_row FROM public.merchant_shipping_charges
  WHERE order_id = v_order AND shipping_quote_id = v_quote;
  IF v_row.funding_source IS DISTINCT FROM 'platform'
     OR v_row.debit_transaction_id IS NOT NULL
     OR v_row.status IS DISTINCT FROM 'reserved'
     OR v_result.balance_after IS NOT NULL THEN
    RAISE EXCEPTION 'T4: flagged reserve must create a reserved platform charge with no debit and NULL balance_after';
  END IF;
  IF pg_temp.wallet_balance(v_merchant) IS DISTINCT FROM v_before
     OR pg_temp.wallet_tx_count(v_order) <> 0 THEN
    RAISE EXCEPTION 'T4: flagged reserve must not move the wallet';
  END IF;
END;
$t4$;

-- T5 (control): a merchant that is NOT flagged is still debited from its wallet.
DO $t5$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000002';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000005';
  v_quote constant uuid := 'b4c13000-0000-4000-8000-000000000005';
  v_before numeric := pg_temp.wallet_balance(v_merchant);
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000002');
  PERFORM public.reserve_merchant_shipping_charge(v_order, v_quote, 'tok-5');
  SELECT * INTO v_row FROM public.merchant_shipping_charges
  WHERE order_id = v_order AND shipping_quote_id = v_quote;
  IF v_row.funding_source IS DISTINCT FROM 'merchant_wallet'
     OR v_row.debit_transaction_id IS NULL
     OR pg_temp.wallet_balance(v_merchant) IS DISTINCT FROM v_before - 4500.00 THEN
    RAISE EXCEPTION 'T5: a non-flagged merchant must still be debited (control)';
  END IF;
END;
$t5$;

-- T5b (control): releasing the wallet-funded reservation restores the balance
-- once, and a repeated release does not credit twice.
DO $t5b$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000002';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000005';
  v_charge uuid;
  v_start numeric := pg_temp.wallet_balance(v_merchant);
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  SELECT id INTO v_charge FROM public.merchant_shipping_charges WHERE order_id = v_order;
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000002');
  PERFORM public.refund_merchant_shipping_charge(v_charge, 'tok-5', 'TEST');
  PERFORM public.refund_merchant_shipping_charge(v_charge, 'tok-5', 'TEST');
  SELECT * INTO v_row FROM public.merchant_shipping_charges WHERE id = v_charge;
  IF v_row.status IS DISTINCT FROM 'refunded' OR v_row.refund_transaction_id IS NULL
     OR pg_temp.wallet_balance(v_merchant) IS DISTINCT FROM v_start + 4500.00 THEN
    RAISE EXCEPTION 'T5b: wallet-funded release must credit exactly once (balance %, start %)',
      pg_temp.wallet_balance(v_merchant), v_start;
  END IF;
  BEGIN
    PERFORM public.refund_merchant_shipping_charge(v_charge, NULL, 'TEST');
    RAISE EXCEPTION 'T5b: NULL attempt token must be rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$t5b$;

-- T7: the funding-mode RPC accepts the owner, rejects unrelated users and
-- a missing identity.
DO $t7$
DECLARE
  v_flagged constant uuid := 'b4c11000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000001');
  IF public.get_gigl_shipping_funding_mode(v_flagged) IS DISTINCT FROM 'platform' THEN
    RAISE EXCEPTION 'T7: owner of a flagged merchant must resolve platform mode';
  END IF;
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000003');
  IF public.get_gigl_shipping_funding_mode(v_flagged) IS DISTINCT FROM 'platform' THEN
    RAISE EXCEPTION 'T7: staff with orders.fulfill must resolve the mode';
  END IF;
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000002');
  BEGIN
    PERFORM public.get_gigl_shipping_funding_mode(v_flagged);
    RAISE EXCEPTION 'T7: an unrelated user must not resolve the mode';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.get_gigl_shipping_funding_mode(v_flagged);
    RAISE EXCEPTION 'T7: a missing identity must not resolve the mode';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$t7$;

-- T4b: a flagged merchant with a funded wallet still reserves as platform.
DO $t4b$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000001';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000008';
  v_quote constant uuid := 'b4c13000-0000-4000-8000-000000000008';
  v_before numeric;
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  UPDATE public.merchant_wallets SET available_balance = 100000 WHERE merchant_id = v_merchant;
  v_before := pg_temp.wallet_balance(v_merchant);
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000001');
  PERFORM public.reserve_merchant_shipping_charge(v_order, v_quote, 'tok-8');
  SELECT * INTO v_row FROM public.merchant_shipping_charges
  WHERE order_id = v_order AND shipping_quote_id = v_quote;
  IF v_row.funding_source IS DISTINCT FROM 'platform' OR v_row.debit_transaction_id IS NOT NULL
     OR pg_temp.wallet_balance(v_merchant) IS DISTINCT FROM v_before
     OR pg_temp.wallet_tx_count(v_order) <> 0 THEN
    RAISE EXCEPTION 'T4b: a funded flagged merchant must still reserve as platform with no debit';
  END IF;
END;
$t4b$;

-- T4c: a flagged merchant with NO wallet row still reserves as platform.
DO $t4c$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000001';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000009';
  v_quote constant uuid := 'b4c13000-0000-4000-8000-000000000009';
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  DELETE FROM public.merchant_wallets WHERE merchant_id = v_merchant;
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000001');
  PERFORM public.reserve_merchant_shipping_charge(v_order, v_quote, 'tok-9');
  SELECT * INTO v_row FROM public.merchant_shipping_charges
  WHERE order_id = v_order AND shipping_quote_id = v_quote;
  IF v_row.funding_source IS DISTINCT FROM 'platform' OR v_row.debit_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'T4c: a flagged merchant without a wallet row must still reserve as platform';
  END IF;
END;
$t4c$;

-- T5c (control): cancelling a wallet-funded reservation restores the balance
-- once, with a refund transaction linked to the charge.
DO $t5c$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000002';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000006';
  v_quote constant uuid := 'b4c13000-0000-4000-8000-000000000006';
  v_start numeric := pg_temp.wallet_balance(v_merchant);
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000002');
  PERFORM public.reserve_merchant_shipping_charge(v_order, v_quote, 'tok-6');
  UPDATE public.orders SET shipping_status = 'cancelled' WHERE id = v_order;
  SELECT * INTO v_row FROM public.merchant_shipping_charges
  WHERE order_id = v_order AND shipping_quote_id = v_quote;
  IF v_row.status IS DISTINCT FROM 'refunded' OR v_row.refund_transaction_id IS NULL
     OR pg_temp.wallet_balance(v_merchant) IS DISTINCT FROM v_start THEN
    RAISE EXCEPTION 'T5c: cancelling a wallet-funded reservation must restore the balance once (balance %, start %)',
      pg_temp.wallet_balance(v_merchant), v_start;
  END IF;
END;
$t5c$;

-- T5d (control): self-fulfilment of a wallet-funded reservation restores the
-- balance once.
DO $t5d$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000002';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000007';
  v_quote constant uuid := 'b4c13000-0000-4000-8000-000000000007';
  v_start numeric := pg_temp.wallet_balance(v_merchant);
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000002');
  PERFORM public.reserve_merchant_shipping_charge(v_order, v_quote, 'tok-7');
  PERFORM public.self_fulfill_order_with_wallet_release(
    v_order, '{"method":"self"}'::jsonb, 'Self-Delivery', NULL
  );
  SELECT * INTO v_row FROM public.merchant_shipping_charges
  WHERE order_id = v_order AND shipping_quote_id = v_quote;
  IF v_row.status IS DISTINCT FROM 'refunded' OR v_row.refund_transaction_id IS NULL
     OR pg_temp.wallet_balance(v_merchant) IS DISTINCT FROM v_start THEN
    RAISE EXCEPTION 'T5d: self-fulfilling a wallet-funded reservation must restore the balance once';
  END IF;
END;
$t5d$;

-- T6: the platform charge can never carry a wallet transaction (CHECK).
DO $t6$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.merchant_shipping_charges WHERE funding_source = 'platform') THEN
    RAISE EXCEPTION 'T6: fixture needs at least one platform charge';
  END IF;
  BEGIN
    UPDATE public.merchant_shipping_charges
    SET debit_transaction_id = (SELECT id FROM public.wallet_transactions LIMIT 1)
    WHERE funding_source = 'platform';
    RAISE EXCEPTION 'T6: platform charge accepted a wallet transaction';
  EXCEPTION WHEN check_violation OR no_data_found THEN
    NULL;
  END;
END;
$t6$;
