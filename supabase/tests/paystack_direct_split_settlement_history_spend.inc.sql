-- T1-T3: spend guards (\ir part of paystack_direct_split_settlement_history.sql).

-- T1: a legacy Paystack credit cannot be paid out.
DO $t1$
DECLARE
  v_result record;
  v_before numeric;
BEGIN
  PERFORM pg_temp.legacy_paystack_credit(1, 100000);
  v_before := (pg_temp.wallet()).available_balance;
  PERFORM pg_temp.check(v_before = 100000, 'T1 fixture balance');
  PERFORM pg_temp.check(
    public.get_merchant_wallet_spendable_balance(pg_temp.merchant()) = 0,
    'T1 legacy Paystack credit must not be spendable');

  SELECT * INTO v_result FROM public.debit_merchant_wallet(
    pg_temp.merchant(), v_before, 'payout', 'Weekly auto-payout - test');
  PERFORM pg_temp.check(v_result.success = false,
    'T1 payout of a Paystack-settled sale must fail');
  PERFORM pg_temp.check(
    v_result.error_message = 'Paystack-settled sales are not withdrawable',
    'T1 payout error: ' || COALESCE(v_result.error_message, '<null>'));
  PERFORM pg_temp.check((pg_temp.wallet()).available_balance = v_before
      AND (pg_temp.wallet()).pending_balance = 0,
    'T1 refused payout must not move the wallet');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM public.wallet_transactions
       WHERE merchant_id = pg_temp.merchant() AND type = 'payout'),
    'T1 refused payout must not write a payout row');

  SELECT * INTO v_result FROM public.debit_merchant_wallet(
    pg_temp.merchant(), 0.01, 'payout', 'One kobo');
  PERFORM pg_temp.check(v_result.success = false,
    'T1 even one kobo of a Paystack-settled sale must not be paid out');
END
$t1$;

-- T2: a legacy Paystack credit cannot pay for a GIG booking.
DO $t2$
DECLARE
  v_caught text;
BEGIN
  PERFORM pg_temp.seed_order(2, 60000);
  PERFORM pg_temp.attach_gigl_quote(2, 5000, 'merchant_wallet');
  PERFORM pg_temp.as_owner();
  BEGIN
    PERFORM public.reserve_merchant_shipping_charge(
      pg_temp.fid(2, 2), pg_temp.fid(3, 2), 'pds-attempt-2');
  EXCEPTION WHEN OTHERS THEN
    v_caught := SQLERRM;
  END;
  PERFORM pg_temp.as_service_role();
  PERFORM pg_temp.check(v_caught LIKE 'MERCHANT_WALLET_INSUFFICIENT%',
    'T2 GIG booking from a Paystack-settled sale must be refused, got: '
      || COALESCE(v_caught, 'success'));
  PERFORM pg_temp.check((pg_temp.wallet()).available_balance = 100000,
    'T2 refused booking must not debit the wallet');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM public.merchant_shipping_charges
       WHERE order_id = pg_temp.fid(2, 2)),
    'T2 refused booking must not create a charge');
END
$t2$;

-- T3: Baci-collected Paystack money and reconciled legacy rows stay spendable.
DO $t3$
DECLARE
  v_result record;
  v_reconciled uuid;
BEGIN
  -- 7,000 that Baci's own Paystack balance received (no subaccount split).
  PERFORM pg_temp.legacy_paystack_credit(
    3, 7000, '{"paystack_collection":"integration"}'::jsonb);
  PERFORM pg_temp.check(
    public.get_merchant_wallet_spendable_balance(pg_temp.merchant()) = 7000,
    'T3 Baci-collected credit must be spendable exactly');

  -- The GIG booking from T2 now fits inside the Baci-held part.
  PERFORM pg_temp.as_owner();
  PERFORM public.reserve_merchant_shipping_charge(
    pg_temp.fid(2, 2), pg_temp.fid(3, 2), 'pds-attempt-2b');
  PERFORM pg_temp.as_service_role();
  PERFORM pg_temp.check((pg_temp.wallet()).available_balance = 102000,
    'T3 booking must debit exactly the quote');
  PERFORM pg_temp.check(
    public.get_merchant_wallet_spendable_balance(pg_temp.merchant()) = 2000,
    'T3 spendable after booking');

  SELECT * INTO v_result FROM public.debit_merchant_wallet(
    pg_temp.merchant(), 2000.01, 'payout', 'Over the spendable part');
  PERFORM pg_temp.check(v_result.success = false,
    'T3 payout above the spendable part must fail');
  SELECT * INTO v_result FROM public.debit_merchant_wallet(
    pg_temp.merchant(), 2000, 'payout', 'Exactly the spendable part');
  PERFORM pg_temp.check(v_result.success = true,
    'T3 payout of the Baci-held part must succeed: '
      || COALESCE(v_result.error_message, ''));

  -- An owner-reconciled legacy row stops counting as exposure.
  SELECT id INTO v_reconciled FROM public.merchant_settlements
   WHERE source_id = pg_temp.fid(2, 1);
  UPDATE public.merchant_settlements
  SET metadata = metadata || '{"legacy_wallet_credit_reconciled":true}'::jsonb
  WHERE id = v_reconciled;
  PERFORM pg_temp.check(
    public.get_merchant_wallet_spendable_balance(pg_temp.merchant()) = 100000,
    'T3 reconciled legacy credit must stop counting as exposure');
  UPDATE public.merchant_settlements
  SET metadata = metadata - 'legacy_wallet_credit_reconciled'
  WHERE id = v_reconciled;

  SELECT * INTO v_result FROM public.debit_merchant_wallet(
    pg_temp.merchant(), 0, 'payout', 'Zero');
  PERFORM pg_temp.check(v_result.success = false
      AND v_result.error_message = 'Invalid amount',
    'T3 zero payout must be rejected');
END
$t3$;
