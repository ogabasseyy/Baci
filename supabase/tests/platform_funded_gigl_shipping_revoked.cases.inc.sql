-- T8: resuming an unconsumed platform reservation after the flag is revoked
-- releases it (no wallet movement) and reports it refunded, so re-quoting is
-- not blocked by the quote-replacement trigger. Runs as the order-4 owner.
DO $t8$
DECLARE
  v_merchant constant uuid := 'b4c11000-0000-4000-8000-000000000001';
  v_order constant uuid := 'b4c12000-0000-4000-8000-000000000004';
  v_quote constant uuid := 'b4c13000-0000-4000-8000-000000000004';
  v_before numeric := pg_temp.wallet_balance(v_merchant);
  v_result record;
  v_row public.merchant_shipping_charges%ROWTYPE;
BEGIN
  UPDATE private.platform_funded_gigl_merchants SET enabled = false
  WHERE merchant_id = v_merchant;
  PERFORM pg_temp.act_as('b4c10000-0000-4000-8000-000000000001');
  SELECT * INTO v_result FROM public.reserve_merchant_shipping_charge(v_order, v_quote, 'tok-8');
  SELECT * INTO v_row FROM public.merchant_shipping_charges
  WHERE order_id = v_order AND shipping_quote_id = v_quote;
  IF v_result.status IS DISTINCT FROM 'refunded'
     OR v_row.status IS DISTINCT FROM 'refunded'
     OR v_row.failure_code IS DISTINCT FROM 'PLATFORM_FUNDING_REVOKED' THEN
    RAISE EXCEPTION 'T8: a revoked-flag resume must release the platform reservation (result %, charge %)',
      v_result.status, v_row.status;
  END IF;
  IF pg_temp.wallet_balance(v_merchant) IS DISTINCT FROM v_before
     OR pg_temp.wallet_tx_count(v_order) <> 0 THEN
    RAISE EXCEPTION 'T8: releasing a platform reservation must not move the wallet';
  END IF;
  -- Re-quoting (replacing the selected quote) is no longer blocked by the
  -- quote-replacement trigger once the reservation is released.
  UPDATE public.orders SET selected_quote_id = NULL WHERE id = v_order;
END;
$t8$;
