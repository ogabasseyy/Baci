-- Permit verified legacy completed refunds to finish the order transition and
-- notifications. Accept the supported legacy canceled shipping spelling.
-- The order finalization below is shared with the side-effect claim's
-- covered path, which must run the same aggregate transition when the last
-- leg lands through a silent self-terminal refund (e.g. PayPal flips the
-- payment row itself) that no per-refund worker ever observes.
-- The provider-verdict transition lives in
-- 20260928179000_record_verified_paystack_cancellation_refund.sql: the
-- combined file exceeded the 300-line maximum, so each state machine
-- ships in its own migration.
CREATE OR REPLACE FUNCTION public.finalize_refunded_cancellation_order_v1(
  p_order_id uuid,
  p_merchant_id uuid,
  p_source_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_settlement public.merchant_settlements%ROWTYPE;
  v_direct_split boolean;
  v_balance numeric;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = p_order_id AND merchant_id = p_merchant_id
       AND cancelled_at IS NOT NULL
       AND shipping_status IN ('cancelled', 'canceled')
  ) THEN
    RAISE EXCEPTION 'refund_order_mismatch';
  END IF;
  UPDATE public.orders SET payment_status = 'refunded', updated_at = now()
    WHERE id = p_order_id AND payment_status IN ('paid', 'partially_paid', 'pending');
  -- Reverse the order's settlements atomically with the refund
  -- transition. This runs only once every funded external leg has
  -- terminal refund evidence, so every gateway leg is refunded —
  -- including non-Paystack legs in mixed-gateway cancellations.
  -- process_due_settlements never joins order state, so a pending row
  -- would otherwise credit the merchant after the customer was
  -- refunded, while settled funds would remain in available balance.
  -- Already-cancelled rows (re-entry on a refunded order) match nothing.
  FOR v_settlement IN
    SELECT settlement.* FROM public.merchant_settlements AS settlement
    WHERE settlement.merchant_id = p_merchant_id
      AND settlement.source_type = 'order'
      AND settlement.source_id = p_order_id
      AND settlement.status IN ('pending', 'processing', 'settled')
    FOR UPDATE
  LOOP
    -- Direct-split settlements settled straight to the merchant's Paystack
    -- subaccount and never credited the Baci wallet: cancel the row below
    -- without moving wallet balances that were never credited.
    v_direct_split := COALESCE(
      v_settlement.metadata ->> 'redvault_direct_split', 'false'
    ) = 'true';
    IF NOT v_direct_split THEN
      IF v_settlement.status IN ('pending', 'processing') THEN
        UPDATE public.merchant_wallets
        SET upcoming_balance = upcoming_balance - v_settlement.net_amount,
            upcoming_count = greatest(0, upcoming_count - 1),
            updated_at = now()
        WHERE id = v_settlement.wallet_id;
      ELSE
        UPDATE public.merchant_wallets
        SET available_balance = available_balance - v_settlement.net_amount,
            total_earned = total_earned - v_settlement.net_amount,
            updated_at = now()
        WHERE id = v_settlement.wallet_id
        RETURNING available_balance INTO v_balance;
        IF v_balance IS NULL THEN
          RAISE EXCEPTION 'refund_settlement_wallet_missing';
        END IF;
        -- Debit-type entry: backfill_wallet_balances rebuilds
        -- available_balance by crediting completed refund rows, so a
        -- refund-typed reversal would add the funds back on rebuild.
        INSERT INTO public.wallet_transactions (
          wallet_id, merchant_id, type, amount, balance_after,
          source_type, source_id, description, status, metadata
        ) VALUES (
          v_settlement.wallet_id, v_settlement.merchant_id, 'debit',
          v_settlement.net_amount, v_balance, 'refund', p_source_id,
          v_settlement.gateway || ' cancellation refund settlement reversal',
          'completed',
          jsonb_build_object('settlement_id', v_settlement.id, 'order_id', p_order_id)
        );
      END IF;
    END IF;
    UPDATE public.merchant_settlements
    SET status = 'cancelled', updated_at = now()
    WHERE id = v_settlement.id;
  END LOOP;
  INSERT INTO public.paystack_cancellation_refund_notifications
    (order_id, merchant_id, event_type)
  VALUES (p_order_id, p_merchant_id, 'processed_customer_email'),
         (p_order_id, p_merchant_id, 'processed_merchant_push')
  ON CONFLICT (order_id, event_type) DO NOTHING;
  -- Close the reviews whose evidence is fully reconciled (unresolved
  -- provider evidence stays open for operations).
  PERFORM public.close_verified_cancellation_refund_reviews_v1(
    p_order_id, p_merchant_id
  );
  -- Flag legs refunded above their payment amount (transition still runs).
  PERFORM public.flag_paystack_cancellation_over_refunds_v1(p_order_id, p_merchant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_refunded_cancellation_order_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_refunded_cancellation_order_v1(uuid, uuid, uuid)
  TO service_role;
