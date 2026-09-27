-- Round-23 review fixes: direct-split settlement reversals skip wallet
-- movement (direct Paystack subaccount settlements never credit the Baci
-- wallet), and the shared refund inventory review closes only when no
-- lifecycle row for the order remains unresolved.
CREATE OR REPLACE FUNCTION private.reverse_uba_redvault_merchant_settlement(
  p_attempt_id uuid,
  p_refund_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_settlement public.merchant_settlements%ROWTYPE;
  v_balance numeric;
  v_direct_split boolean;
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
    -- Direct-split settlements are informational accounting for funds that
    -- moved through the Paystack subaccount: the wallet was never
    -- credited, so reversing one must cancel the settlement without
    -- debiting wallet funds.
    v_direct_split := COALESCE(
      v_settlement.metadata ->> 'redvault_direct_split', 'false'
    ) = 'true';
    IF v_settlement.status IN ('pending', 'processing') THEN
      IF NOT v_direct_split THEN
        UPDATE public.merchant_wallets
        SET upcoming_balance = upcoming_balance - v_settlement.net_amount,
            upcoming_count = greatest(0, upcoming_count - 1),
            updated_at = pg_catalog.now()
        WHERE id = v_settlement.wallet_id;
      END IF;
    ELSE
      IF NOT v_direct_split THEN
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
    END IF;

    UPDATE public.merchant_settlements
    SET status = 'cancelled', updated_at = pg_catalog.now()
    WHERE id = v_settlement.id;
  END LOOP;
END;
$$;
ALTER FUNCTION private.reverse_uba_redvault_merchant_settlement(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reverse_uba_redvault_merchant_settlement(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

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
  v_direct_split boolean;
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
    -- Direct-split settlements never credited the wallet: reduce the
    -- settlement accounting without debiting wallet funds.
    v_direct_split := COALESCE(
      v_settlement.metadata ->> 'redvault_direct_split', 'false'
    ) = 'true';

    IF v_delta > 0 THEN
      IF v_settlement.status IN ('pending', 'processing') THEN
        IF NOT v_direct_split THEN
          UPDATE public.merchant_wallets
          SET upcoming_balance = upcoming_balance - v_delta,
              updated_at = pg_catalog.now()
          WHERE id = v_settlement.wallet_id;
        END IF;
      ELSE
        IF NOT v_direct_split THEN
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
            v_settlement.wallet_id, v_settlement.merchant_id, 'debit',
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

-- The shared order review must stay open while any lifecycle row for the
-- order still needs review: resolving one refund releases only its own
-- units, and the enqueue trigger never refires for the refunds that
-- remain blocked.
CREATE OR REPLACE FUNCTION public.resolve_uba_redvault_refund_inventory_review(
  p_refund_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_refund private.uba_redvault_refunds%ROWTYPE;
  v_lifecycle private.uba_redvault_refund_lifecycle%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: REDVAULT refund review resolution requires service_role';
  END IF;

  SELECT * INTO STRICT v_refund
  FROM private.uba_redvault_refunds
  WHERE id = p_refund_id;
  SELECT * INTO STRICT v_lifecycle
  FROM private.uba_redvault_refund_lifecycle
  WHERE refund_id = p_refund_id
  FOR UPDATE;

  IF v_lifecycle.inventory_state <> 'review_required' THEN
    RETURN jsonb_build_object('success', true, 'refundId', p_refund_id,
      'inventoryState', v_lifecycle.inventory_state);
  END IF;

  v_result := private.release_redvault_refund_inventory_units(p_refund_id);
  UPDATE private.uba_redvault_refund_lifecycle
  SET inventory_state = 'released', review_reason = NULL, inventory_receipt = v_result
  WHERE refund_id = p_refund_id AND inventory_state = 'review_required';
  UPDATE public.reconciliation_review
  SET resolved_at = pg_catalog.clock_timestamp(),
      resolution_notes = 'REDVAULT refund inventory safely released by protected resolver.'
  WHERE issue_type = 'serialized_inventory_confirmation_failed'
    AND order_id = v_lifecycle.order_id
    AND (metadata->>'refundId' = p_refund_id::text
      OR metadata->'refundIds' ? p_refund_id::text)
    AND resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_refund_lifecycle AS remaining
      WHERE remaining.order_id = v_lifecycle.order_id
        AND remaining.inventory_state = 'review_required'
        AND remaining.refund_id IS DISTINCT FROM p_refund_id
    );
  RETURN v_result || jsonb_build_object('inventoryState', 'released');
END;
$$;
ALTER FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid)
  TO service_role;
