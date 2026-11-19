-- T4-T8: direct-split recorders, refund finalizer and privileges
-- (\ir part of paystack_direct_split_settlement_history.sql).

-- T4: a direct-split sale is settlement history with no wallet movement.
DO $t4$
DECLARE
  v_before public.merchant_wallets;
  v_after public.merchant_wallets;
  v_id uuid;
  v_again uuid;
  v_row public.merchant_settlements;
  v_caught text;
BEGIN
  v_before := pg_temp.wallet();
  PERFORM pg_temp.seed_order(4, 250000);
  v_id := public.record_paystack_direct_split_settlement(
    pg_temp.merchant(), 'order', pg_temp.fid(2, 4), 'paystack', 'PDS-REF-4',
    250000, 3500, 2050, 'Order payment via paystack',
    '{"paystack_transaction_charge_kobo":"205000"}'::jsonb, 'ACCT_pdsfixture');
  PERFORM pg_temp.check(v_id IS NOT NULL, 'T4 direct-split row missing');
  SELECT * INTO v_row FROM public.merchant_settlements WHERE id = v_id;
  PERFORM pg_temp.check(v_row.status = 'settled' AND v_row.settlement_notified,
    'T4 direct-split row must be settled history');
  PERFORM pg_temp.check(v_row.net_amount = 247950 AND v_row.platform_fee = 2050,
    'T4 net must be gross minus Baci''s split charge');
  PERFORM pg_temp.check(v_row.description = 'Settled to your bank by Paystack',
    'T4 description');
  PERFORM pg_temp.check(v_row.metadata ->> 'paystack_direct_split' = 'true'
      AND v_row.metadata ->> 'paystack_subaccount_code' = 'ACCT_pdsfixture'
      AND v_row.metadata ->> 'paystack_transaction_charge_kobo' = '205000',
    'T4 metadata');

  v_again := public.record_paystack_direct_split_settlement(
    pg_temp.merchant(), 'order', pg_temp.fid(2, 4), 'paystack', 'PDS-REF-4',
    250000, 3500, 2050, 'retry', '{}'::jsonb, 'ACCT_pdsfixture');
  PERFORM pg_temp.check(v_again IS NULL, 'T4 retry must be idempotent');
  PERFORM public.process_due_settlements();

  v_after := pg_temp.wallet();
  PERFORM pg_temp.check(
    v_after.available_balance = v_before.available_balance
      AND v_after.upcoming_balance = v_before.upcoming_balance
      AND v_after.upcoming_count = v_before.upcoming_count
      AND v_after.total_earned = v_before.total_earned,
    'T4 a direct-split sale must never move the Baci wallet');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM public.wallet_transactions WHERE source_id = pg_temp.fid(2, 4)),
    'T4 a direct-split sale must not write a wallet transaction');
  PERFORM pg_temp.check(
    public.get_merchant_wallet_spendable_balance(pg_temp.merchant()) = 0,
    'T4 direct-split history must not count as spendable');

  -- A bank-transfer DVA split: Paystack paid the merchant everything, so the
  -- verified share, not the requested platform fee, is what history records.
  PERFORM pg_temp.seed_order(9, 80000);
  v_id := public.record_paystack_direct_split_settlement(
    pg_temp.merchant(), 'order', pg_temp.fid(2, 9), 'paystack', 'PDS-REF-9',
    80000, 0, 1200, 'Order payment via paystack',
    '{"paystack_subaccount_share_kobo":8000000,"paystack_integration_share_kobo":0}'::jsonb,
    'ACCT_pdsfixture');
  SELECT * INTO v_row FROM public.merchant_settlements WHERE id = v_id;
  PERFORM pg_temp.check(v_row.net_amount = 80000 AND v_row.platform_fee = 0
      AND (v_row.metadata ->> 'requested_platform_fee')::numeric = 1200,
    'T4 history must record the verified merchant share');
  -- Production DVA shape: Baci's share is 0 and Paystack's fee (300) stays
  -- in gateway_fee, so platform_fee is 0 and gross = net + gateway + platform.
  PERFORM pg_temp.seed_order(11, 835000);
  v_id := public.record_paystack_direct_split_settlement(
    pg_temp.merchant(), 'order', pg_temp.fid(2, 11), 'paystack', 'PDS-REF-11',
    835000, 300, 2350, 'Order payment via paystack',
    '{"paystack_subaccount_share_kobo":83470000,"paystack_integration_share_kobo":0}'::jsonb,
    'ACCT_pdsfixture');
  SELECT * INTO v_row FROM public.merchant_settlements WHERE id = v_id;
  PERFORM pg_temp.check(v_row.net_amount = 834700 AND v_row.platform_fee = 0
      AND v_row.gateway_fee = 300
      AND v_row.gross_amount - v_row.gateway_fee - v_row.platform_fee = v_row.net_amount,
    'T4 a DVA split must book Paystack''s fee as gateway fee, not Baci''s');
  v_caught := NULL;
  BEGIN
    PERFORM pg_temp.seed_order(10, 1000);
    PERFORM public.record_paystack_direct_split_settlement(
      pg_temp.merchant(), 'order', pg_temp.fid(2, 10), 'paystack', 'PDS-REF-10',
      1000, 0, 0, 'Order payment via paystack',
      '{"paystack_subaccount_share_kobo":100001}'::jsonb, 'ACCT_pdsfixture');
  EXCEPTION WHEN OTHERS THEN
    v_caught := SQLERRM;
  END;
  PERFORM pg_temp.check(v_caught = 'paystack_direct_settlement_amount_invalid',
    'T4 a share above the gross must be refused, got: ' || COALESCE(v_caught, 'success'));
END
$t4$;

-- T5: the recorder fails closed on anything but a proven Paystack split.
DO $t5$
DECLARE
  v_case record;
  v_caught text;
BEGIN
  PERFORM pg_temp.seed_order(5, 1000);
  PERFORM pg_temp.seed_order(6, 1000);
  UPDATE public.orders SET shipping_status = 'cancelled', cancelled_at = now()
   WHERE id = pg_temp.fid(2, 6);
  FOR v_case IN
    SELECT * FROM (VALUES
      ('korapay', pg_temp.fid(2, 5), 'ACCT_pdsfixture', 'paystack_direct_settlement_gateway_mismatch'),
      ('paystack', pg_temp.fid(2, 5), '', 'paystack_direct_settlement_subaccount_missing'),
      ('paystack', pg_temp.fid(2, 5), 'not-a-code', 'paystack_direct_settlement_subaccount_missing'),
      ('paystack', pg_temp.fid(2, 5), 'ACCT_someoneelse', 'paystack_direct_settlement_subaccount_mismatch'),
      ('paystack', pg_temp.fid(2, 99), 'ACCT_pdsfixture', 'paystack_direct_settlement_order_mismatch'),
      ('paystack', pg_temp.fid(2, 6), 'ACCT_pdsfixture', 'settlement_order_cancelled')
    ) AS c(gateway, order_id, subaccount, expected)
  LOOP
    v_caught := NULL;
    BEGIN
      PERFORM public.record_paystack_direct_split_settlement(
        pg_temp.merchant(), 'order', v_case.order_id, v_case.gateway,
        'PDS-REF-5', 1000, 0, 0, 'reject', '{}'::jsonb, v_case.subaccount);
    EXCEPTION WHEN OTHERS THEN
      v_caught := SQLERRM;
    END;
    PERFORM pg_temp.check(v_caught = v_case.expected,
      'T5 expected ' || v_case.expected || ', got ' || COALESCE(v_caught, 'success'));
  END LOOP;
END
$t5$;

-- T6: the GIGL variant keeps the customer-paid delivery fee and records
-- whether Baci's split actually collected it.
DO $t6$
DECLARE
  v_paid uuid;
  v_unpaid uuid;
  v_caught text;
BEGIN
  PERFORM pg_temp.seed_order(7, 54000);
  PERFORM pg_temp.attach_gigl_quote(7, 4000, 'customer_checkout');
  PERFORM pg_temp.check(
    public.get_order_paystack_split_retained_shipping_kobo(pg_temp.fid(2, 7), pg_temp.merchant(), 'pds-buyer@example.test') = 400000,
    'T6 checkout read must return the delivery fee in kobo');
  PERFORM pg_temp.check(
    public.get_order_paystack_split_retained_shipping_kobo(pg_temp.fid(2, 4), pg_temp.merchant(), ' PDS-Buyer@Example.test ') = 0,
    'T6 a non-GIGL order retains nothing');
  v_caught := NULL;
  BEGIN
    PERFORM public.get_order_paystack_split_retained_shipping_kobo(
      pg_temp.fid(2, 7), pg_temp.merchant(), 'someone-else@example.test');
  EXCEPTION WHEN OTHERS THEN
    v_caught := SQLERRM;
  END;
  PERFORM pg_temp.check(v_caught = 'paystack_split_order_not_found',
    'T6 the checkout read must require the order''s customer email, got: '
      || COALESCE(v_caught, 'success'));

  -- Split charge 2,050 + 4,000 delivery = 605000 kobo: collected. Paystack's
  -- verified shares are present, as the executor forwards them: merchant
  -- 47,950, Baci 5,150 (its 6,050 charge less Paystack's 900 fee).
  v_paid := public.record_paystack_direct_split_settlement_gigl_v1(
    pg_temp.merchant(), 'order', pg_temp.fid(2, 7), 'paystack', 'PDS-REF-7',
    54000, 900, 2050, 'Order payment via paystack',
    '{"paystack_transaction_charge_kobo":"605000","paystack_subaccount_share_kobo":"4795000","paystack_integration_share_kobo":"515000"}'::jsonb,
    'ACCT_pdsfixture');
  PERFORM pg_temp.check(
    (SELECT platform_fee = 5150 AND net_amount = 47950 AND gateway_fee = 900
        AND gross_amount - gateway_fee - platform_fee = net_amount
        AND metadata ->> 'retained_shipping_amount' = '4000.00'
        AND metadata ->> 'retained_shipping_collected_by_split' = 'true'
       FROM public.merchant_settlements WHERE id = v_paid),
    'T6 GIGL direct split must record the retained delivery fee and the verified shares');
  PERFORM pg_temp.check(
    public.get_order_paystack_split_retained_shipping_kobo(pg_temp.fid(2, 7), pg_temp.merchant(), 'pds-buyer@example.test') = 0,
    'T6 a retained fee must not be retained twice');

  -- A checkout from before the fix: Baci's split carried only the fee.
  PERFORM pg_temp.seed_order(8, 54000);
  PERFORM pg_temp.attach_gigl_quote(8, 4000, 'customer_checkout');
  v_unpaid := public.record_paystack_direct_split_settlement_gigl_v1(
    pg_temp.merchant(), 'order', pg_temp.fid(2, 8), 'paystack', 'PDS-REF-8',
    54000, 900, 2050, 'Order payment via paystack',
    '{"paystack_transaction_charge_kobo":"205000","paystack_subaccount_share_kobo":"5195000"}'::jsonb,
    'ACCT_pdsfixture');
  PERFORM pg_temp.check(
    (SELECT metadata ->> 'retained_shipping_collected_by_split' = 'false'
        AND (metadata ->> 'retained_shipping_amount')::numeric = 0
        AND (metadata ->> 'retained_shipping_intended_amount')::numeric = 4000
        AND platform_fee = 2050 AND net_amount = 51950
       FROM public.merchant_settlements WHERE id = v_unpaid),
    'T6 an uncollected delivery fee must be flagged and not booked as Baci''s');
  PERFORM pg_temp.check(
    public.get_order_paystack_split_retained_shipping_kobo(pg_temp.fid(2, 8), pg_temp.merchant(), 'pds-buyer@example.test') = 400000,
    'T6 an uncollected delivery fee must still be owed, not counted as retained');
  -- The prepaid-shipping gate Baci books GIG against.
  PERFORM pg_temp.check(
    private.order_settled_gigl_retained_amount(pg_temp.fid(2, 8), pg_temp.merchant()) = 0
      AND private.order_settled_gigl_retained_amount(pg_temp.fid(2, 7), pg_temp.merchant()) = 4000,
    'T6 only a collected delivery fee may count as prepaid GIG shipping');
  PERFORM pg_temp.check(
    public.get_merchant_wallet_spendable_balance(pg_temp.merchant()) = 0,
    'T6 GIGL direct split must not create spendable balance');
END
$t6$;

-- T7: refunding a cancelled direct-split sale debits nothing.
DO $t7$
DECLARE
  v_before public.merchant_wallets := pg_temp.wallet();
BEGIN
  UPDATE public.orders SET shipping_status = 'cancelled', cancelled_at = now()
   WHERE id = pg_temp.fid(2, 4);
  PERFORM public.finalize_refunded_cancellation_order_v1(
    pg_temp.fid(2, 4), pg_temp.merchant(), NULL);
  PERFORM pg_temp.check(
    (SELECT status FROM public.merchant_settlements
      WHERE source_id = pg_temp.fid(2, 4)) = 'cancelled',
    'T7 the direct-split row must be cancelled');
  PERFORM pg_temp.check(
    (pg_temp.wallet()).available_balance = v_before.available_balance
      AND (pg_temp.wallet()).total_earned = v_before.total_earned,
    'T7 refund must not debit a wallet the sale never credited');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM public.wallet_transactions
       WHERE source_type = 'refund' AND metadata ->> 'order_id' = pg_temp.fid(2, 4)::text),
    'T7 refund must not write a reversal debit');
END
$t7$;

-- T8: privileges, asserted through the catalog.
DO $t8$
DECLARE
  v_fn text;
  v_role text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.record_paystack_direct_split_settlement(uuid,text,uuid,text,text,numeric,numeric,numeric,text,jsonb,text)',
    'public.record_paystack_direct_split_settlement_gigl_v1(uuid,text,uuid,text,text,numeric,numeric,numeric,text,jsonb,text)',
    'public.get_merchant_wallet_spendable_balance(uuid)',
    'public.debit_merchant_wallet(uuid,numeric,text,text)'
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE'),
        'T8 ' || v_role || ' must not execute ' || v_fn);
    END LOOP;
    PERFORM pg_temp.check(pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE'),
      'T8 service_role must execute ' || v_fn);
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'private.is_direct_split_settlement(jsonb)',
    'private.gigl_order_remaining_retained_shipping(uuid,uuid)',
    'private.merchant_wallet_direct_settled_exposure(uuid)'
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE'),
        'T8 ' || v_role || ' must not execute ' || v_fn);
    END LOOP;
  END LOOP;
  PERFORM pg_temp.check(
    pg_catalog.has_function_privilege('authenticated',
      'public.reserve_merchant_shipping_charge(uuid,uuid,text)', 'EXECUTE'),
    'T8 owners must still reserve GIG bookings');
  -- The checkout read is proof-bound (T6) and serves guest checkouts.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.check(pg_catalog.has_function_privilege(v_role,
        'public.get_order_paystack_split_retained_shipping_kobo(uuid,uuid,text)', 'EXECUTE'),
      'T8 ' || v_role || ' must execute the proof-bound checkout read');
  END LOOP;
END
$t8$;
