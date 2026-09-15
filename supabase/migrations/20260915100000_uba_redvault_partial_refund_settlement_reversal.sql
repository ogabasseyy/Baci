-- REDVAULT partial refunds must reduce the merchant settlement exactly once.
-- A later full refund reverses only the settlement balance that remains.

CREATE OR REPLACE FUNCTION private.reverse_uba_redvault_partial_settlement(
  p_attempt_id uuid,
  p_refund_id uuid,
  p_refunded_kobo bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_settlement public.merchant_settlements%ROWTYPE;
  v_original_net numeric;
  v_reversed_net numeric;
  v_target_net numeric;
  v_delta numeric;
  v_balance numeric;
  v_processed_ids jsonb;
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
    v_processed_ids := COALESCE(
      v_settlement.metadata -> 'redvault_processed_refund_ids',
      '[]'::jsonb
    );
    IF v_processed_ids ? p_refund_id::text THEN
      CONTINUE;
    END IF;

    v_original_net := COALESCE(
      NULLIF(v_settlement.metadata ->> 'redvault_original_net_amount', '')::numeric,
      v_settlement.net_amount
    );
    v_reversed_net := COALESCE(
      NULLIF(v_settlement.metadata ->> 'redvault_reversed_net_amount', '')::numeric,
      0
    );
    v_target_net := LEAST(
      v_original_net,
      round(v_original_net * p_refunded_kobo / v_attempt.amount_kobo, 2)
    );
    v_delta := greatest(0, v_target_net - v_reversed_net);

    IF v_delta > 0 THEN
      IF v_settlement.status IN ('pending', 'processing') THEN
        UPDATE public.merchant_wallets
        SET upcoming_balance = upcoming_balance - v_delta,
            updated_at = pg_catalog.now()
        WHERE id = v_settlement.wallet_id;
      ELSE
        UPDATE public.merchant_wallets
        SET available_balance = available_balance - v_delta,
            total_earned = total_earned - v_delta,
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
          v_delta, v_balance, 'refund', p_refund_id,
          'UBA REDVAULT partial capture refund settlement reversal', 'completed',
          jsonb_build_object(
            'settlement_id', v_settlement.id,
            'attempt_id', p_attempt_id,
            'refund_id', p_refund_id,
            'partial', true
          )
        );
      END IF;

      UPDATE public.merchant_settlements
      SET net_amount = net_amount - v_delta,
          metadata = metadata
            || jsonb_build_object(
              'redvault_original_net_amount', v_original_net,
              'redvault_reversed_net_amount', v_reversed_net + v_delta
            )
            || jsonb_build_object(
              'redvault_processed_refund_ids', v_processed_ids || to_jsonb(p_refund_id::text)
            ),
          updated_at = pg_catalog.now()
      WHERE id = v_settlement.id;
    ELSE
      UPDATE public.merchant_settlements
      SET metadata = metadata
        || jsonb_build_object(
          'redvault_original_net_amount', v_original_net,
          'redvault_reversed_net_amount', v_reversed_net,
          'redvault_processed_refund_ids', v_processed_ids || to_jsonb(p_refund_id::text)
        ),
        updated_at = pg_catalog.now()
      WHERE id = v_settlement.id;
    END IF;
  END LOOP;
END;
$$;
ALTER FUNCTION private.reverse_uba_redvault_partial_settlement(uuid, uuid, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reverse_uba_redvault_partial_settlement(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.finalize_uba_redvault_refund_settlement_reversal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_processed_kobo bigint;
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

  SELECT transaction.* INTO v_transaction
  FROM public.transactions AS transaction
  WHERE transaction.order_id = v_attempt.order_id
    AND transaction.merchant_id = v_attempt.merchant_id
    AND transaction.gateway = 'paystack'
    AND transaction.gateway_reference = v_attempt.reference
    AND transaction.transaction_type = 'payment'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_attempt.order_id FOR UPDATE;
  IF v_order.merchant_id IS DISTINCT FROM v_attempt.merchant_id
    OR v_order.payment_method IS DISTINCT FROM 'uba_redvault'
    OR round(v_transaction.amount * 100)::bigint IS DISTINCT FROM v_attempt.amount_kobo
    OR upper(v_transaction.currency) IS DISTINCT FROM v_attempt.currency
    OR (v_transaction.status IN ('pending', 'completed', 'refunded')) IS NOT TRUE
    OR (v_order.payment_status IN ('unpaid', 'paid', 'refunded')) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum(refund.amount_kobo), 0)::bigint INTO v_processed_kobo
  FROM private.uba_redvault_refunds AS refund
  WHERE refund.attempt_id = v_attempt.id AND refund.state = 'processed';

  IF v_processed_kobo < v_attempt.amount_kobo THEN
    PERFORM private.reverse_uba_redvault_partial_settlement(
      v_attempt.id, NEW.id, v_processed_kobo
    );
  ELSIF v_processed_kobo = v_attempt.amount_kobo THEN
    PERFORM private.reverse_uba_redvault_merchant_settlement(v_attempt.id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.finalize_uba_redvault_refund_settlement_reversal() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.finalize_uba_redvault_refund_settlement_reversal() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.reverse_uba_redvault_partial_settlement(uuid, uuid, bigint) IS
  'Applies an idempotent proportional REDVAULT settlement reversal for processed partial refunds.';
