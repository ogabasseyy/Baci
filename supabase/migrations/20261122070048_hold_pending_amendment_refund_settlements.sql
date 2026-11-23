-- Hold only due Paystack integration settlements with an open amendment refund.
CREATE OR REPLACE FUNCTION "public"."process_due_settlements"() RETURNS TABLE("processed_count" integer, "total_amount" numeric, "details" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_processed INTEGER := 0;
  v_total DECIMAL(12,2) := 0;
  v_details JSONB := '[]'::JSONB;
  v_settlement RECORD;
BEGIN
  -- Process all pending settlements that are due
  FOR v_settlement IN
    SELECT *
    FROM public.merchant_settlements
    WHERE status = 'pending'
    AND expected_settlement_date <= CURRENT_DATE
    FOR UPDATE SKIP LOCKED
  LOOP
    IF v_settlement.source_type = 'order'
      AND v_settlement.gateway = 'paystack'
      AND v_settlement.metadata->>'paystack_collection' = 'integration'
    THEN
      -- Amendment writers lock by order before adjusting settlement. Skip
      -- contention instead of waiting while holding the settlement row.
      IF NOT pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended('baci_order_payment:' || v_settlement.source_id::text, 0)
      ) THEN CONTINUE; END IF;
      IF EXISTS (
        SELECT 1 FROM private.paid_order_amendments a
        WHERE a.order_id = v_settlement.source_id
          AND a.merchant_id = v_settlement.merchant_id
          AND a.state = 'awaiting_refund'
      ) THEN CONTINUE; END IF;
    END IF;

    -- Update settlement status
    UPDATE public.merchant_settlements
    SET
      status = 'settled',
      actual_settlement_date = CURRENT_DATE,
      updated_at = NOW()
    WHERE id = v_settlement.id;

    -- Move from upcoming to available balance
    UPDATE public.merchant_wallets
    SET
      upcoming_balance = upcoming_balance - v_settlement.net_amount,
      upcoming_count = GREATEST(0, upcoming_count - 1),
      available_balance = available_balance + v_settlement.net_amount,
      total_earned = total_earned + v_settlement.net_amount,
      updated_at = NOW()
    WHERE id = v_settlement.wallet_id;

    -- Create wallet transaction
    INSERT INTO public.wallet_transactions (
      wallet_id,
      merchant_id,
      type,
      amount,
      balance_after,
      source_type,
      source_id,
      description,
      status
    )
    SELECT
      v_settlement.wallet_id,
      v_settlement.merchant_id,
      'credit',
      v_settlement.net_amount,
      mw.available_balance,
      v_settlement.source_type,
      v_settlement.source_id,
      COALESCE(v_settlement.description, 'Settlement received') || ' via ' || v_settlement.gateway,
      'completed'
    FROM public.merchant_wallets mw WHERE mw.id = v_settlement.wallet_id;

    v_processed := v_processed + 1;
    v_total := v_total + v_settlement.net_amount;
    v_details := v_details || jsonb_build_object(
      'settlement_id', v_settlement.id,
      'merchant_id', v_settlement.merchant_id,
      'amount', v_settlement.net_amount,
      'gateway', v_settlement.gateway
    );
  END LOOP;

  RETURN QUERY SELECT v_processed, v_total, v_details;
END;
$$;
