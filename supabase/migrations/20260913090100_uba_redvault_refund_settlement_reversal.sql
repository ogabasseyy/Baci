-- A fully processed REDVAULT capture refunds the exact Paystack settlement
-- recorded for its order/reference. Keep the wallet movement and cancellation
-- in the same transaction as the durable refund state.

CREATE OR REPLACE FUNCTION private.reverse_uba_redvault_merchant_settlement(
  p_attempt_id uuid,
  p_refund_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_settlement public.merchant_settlements%ROWTYPE;
  v_balance numeric;
BEGIN
  SELECT * INTO STRICT v_attempt
  FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id;

  FOR v_settlement IN
    SELECT settlement.*
    FROM public.merchant_settlements AS settlement
    WHERE settlement.merchant_id = v_attempt.merchant_id
      AND settlement.source_type = 'order'
      AND settlement.source_id = v_attempt.order_id
      AND settlement.gateway = 'paystack'
      AND settlement.gateway_reference = v_attempt.reference
      AND settlement.status IN ('pending', 'processing', 'settled')
    FOR UPDATE
  LOOP
    IF v_settlement.status IN ('pending', 'processing') THEN
      UPDATE public.merchant_wallets
      SET upcoming_balance = upcoming_balance - v_settlement.net_amount,
          upcoming_count = greatest(0, upcoming_count - 1),
          updated_at = pg_catalog.now()
      WHERE id = v_settlement.wallet_id;
    ELSE
      UPDATE public.merchant_wallets
      SET available_balance = available_balance - v_settlement.net_amount,
          total_earned = total_earned - v_settlement.net_amount,
          updated_at = pg_catalog.now()
      WHERE id = v_settlement.wallet_id
      RETURNING available_balance INTO v_balance;

      IF v_balance IS NULL THEN
        RAISE EXCEPTION 'redvault_settlement_wallet_missing';
      END IF;

      INSERT INTO public.wallet_transactions (
        wallet_id, merchant_id, type, amount, balance_after,
        source_type, source_id, description, status, metadata
      ) VALUES (
        v_settlement.wallet_id, v_settlement.merchant_id, 'refund',
        v_settlement.net_amount, v_balance, 'refund', p_refund_id,
        'UBA REDVAULT capture refund settlement reversal', 'completed',
        jsonb_build_object('settlement_id', v_settlement.id, 'attempt_id', p_attempt_id)
      );
    END IF;

    UPDATE public.merchant_settlements
    SET status = 'cancelled', updated_at = pg_catalog.now()
    WHERE id = v_settlement.id;
  END LOOP;
END;
$$;
ALTER FUNCTION private.reverse_uba_redvault_merchant_settlement(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reverse_uba_redvault_merchant_settlement(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.finalize_uba_redvault_refund_settlement_reversal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
BEGIN
  IF NEW.state IS DISTINCT FROM 'processed'
    OR TG_OP = 'UPDATE' AND OLD.state IS NOT DISTINCT FROM 'processed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO STRICT v_attempt
  FROM private.uba_redvault_payment_attempts
  WHERE id = NEW.attempt_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || v_attempt.order_id::text, 0)
  );

  IF (SELECT sum(refund.amount_kobo) FROM private.uba_redvault_refunds AS refund
    WHERE refund.attempt_id = v_attempt.id AND refund.state = 'processed')
      IS DISTINCT FROM v_attempt.amount_kobo THEN
    RETURN NEW;
  END IF;

  SELECT transaction.* INTO v_transaction
  FROM public.transactions AS transaction
  WHERE transaction.order_id = v_attempt.order_id
    AND transaction.merchant_id = v_attempt.merchant_id
    AND transaction.gateway = 'paystack'
    AND transaction.gateway_reference = v_attempt.reference
    AND transaction.transaction_type = 'payment'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_attempt.order_id FOR UPDATE;
  IF v_order.merchant_id IS DISTINCT FROM v_attempt.merchant_id
    OR v_order.payment_method IS DISTINCT FROM 'uba_redvault'
    OR round(v_transaction.amount * 100)::bigint IS DISTINCT FROM v_attempt.amount_kobo
    OR upper(v_transaction.currency) IS DISTINCT FROM v_attempt.currency
    OR (v_transaction.status IN ('pending', 'completed', 'refunded')) IS NOT TRUE
    OR (v_order.payment_status IN ('unpaid', 'paid', 'refunded')) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  PERFORM private.reverse_uba_redvault_merchant_settlement(v_attempt.id, NEW.id);
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.finalize_uba_redvault_refund_settlement_reversal() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.finalize_uba_redvault_refund_settlement_reversal() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER finalize_uba_redvault_refund_settlement_reversal
  AFTER INSERT OR UPDATE OF state ON private.uba_redvault_refunds
  FOR EACH ROW EXECUTE FUNCTION private.finalize_uba_redvault_refund_settlement_reversal();

CREATE OR REPLACE FUNCTION private.prevent_uba_redvault_refunded_settlement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
BEGIN
  IF NEW.source_type IS DISTINCT FROM 'order'
    OR NEW.gateway IS DISTINCT FROM 'paystack'
    OR NULLIF(trim(NEW.gateway_reference), '') IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_attempt
  FROM private.uba_redvault_payment_attempts AS attempt
  WHERE attempt.order_id = NEW.source_id
    AND attempt.merchant_id = NEW.merchant_id
    AND attempt.reference = NEW.gateway_reference;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || v_attempt.order_id::text, 0)
  );
  IF (SELECT sum(refund.amount_kobo) FROM private.uba_redvault_refunds AS refund
    WHERE refund.attempt_id = v_attempt.id AND refund.state = 'processed')
      IS NOT DISTINCT FROM v_attempt.amount_kobo THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION private.prevent_uba_redvault_refunded_settlement() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.prevent_uba_redvault_refunded_settlement() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_uba_redvault_refunded_settlement
  BEFORE INSERT ON public.merchant_settlements
  FOR EACH ROW EXECUTE FUNCTION private.prevent_uba_redvault_refunded_settlement();

COMMENT ON FUNCTION private.reverse_uba_redvault_merchant_settlement(uuid, uuid) IS
  'Cancels the exact REDVAULT Paystack order settlement and reverses its pending or settled wallet impact after a full processed capture refund.';
