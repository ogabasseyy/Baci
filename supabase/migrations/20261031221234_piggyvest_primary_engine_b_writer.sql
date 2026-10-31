-- piggyvest-engine-owner: P5-engine-schema
-- PiggyVest transfer engine, part 5 of 6: the B writer.
--
-- request_b_effect(transfer, effect, amount) is the only entry for changing
-- B for a transfer. It is internal (no role may execute it; engine
-- functions owned by the migration owner call it) and it:
--   * accepts only the effects transfer_kinds lists for the kind, each in the
--     transfer state it belongs to; debits must be the full leg amount;
--   * answers 'duplicate' for a repeated (transfer, effect) with the same
--     amount ('review' while that request is in review) and 'conflict' for
--     another amount, writing nothing;
--   * under the family lock keeps the collect family's requested and applied
--     credits within its hold debit (R4) and a payout restore within its
--     freeze; anything above is recorded for review and writes nothing;
--   * applies inline only when session_may_write_b() is true. A hold debit
--     must apply inline, so outside an engine session it raises
--     b_effect_requires_engine_login. A payout freeze is never applied
--     inline. Everything else stays requested for the worker.
-- apply_requested_b_effects(limit) is that worker pass, executable by the
-- transfer worker role from an enabled worker login only. Each request is
-- applied once under its row lock; concurrent passes skip locked rows, and a
-- request that fails to apply goes to review instead of blocking the rest.
BEGIN;
CREATE FUNCTION piggyvest_primary.apply_b_effect(p_effect_id uuid, p_inline boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_effect piggyvest_primary.transfer_b_effects%ROWTYPE;
  v_transfer piggyvest_primary.wallet_transfers%ROWTYPE;
  v_merchant uuid;
  v_wallet_id uuid;
  v_balance numeric;
  v_amount numeric;
  v_debit boolean;
  v_ledger uuid := pg_catalog.gen_random_uuid();
BEGIN
  SELECT effect.* INTO v_effect FROM piggyvest_primary.transfer_b_effects effect
    WHERE effect.id = p_effect_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown B effect' USING ERRCODE = '22023'; END IF;
  -- Already applied or in review: nothing to do, and never counted as applied.
  IF v_effect.state <> 'requested' THEN RETURN 'unchanged'; END IF;
  SELECT transfer.* INTO v_transfer FROM piggyvest_primary.wallet_transfers transfer
    WHERE transfer.id = v_effect.transfer_id;
  SELECT integration.merchant_id INTO v_merchant FROM piggyvest_primary.integrations integration
    WHERE integration.id = v_transfer.integration_id;
  IF v_transfer.customer_id IS NULL THEN
    UPDATE piggyvest_primary.transfer_b_effects SET state = 'review', review_reason = 'customer_detached'
      WHERE id = p_effect_id;
    UPDATE piggyvest_primary.wallet_transfers SET effect_state = 'review'
      WHERE id = v_transfer.id AND effect_state = 'pending';
    RETURN 'review';
  END IF;
  v_amount := v_effect.amount_kobo::numeric / 100;
  v_debit := v_effect.effect IN ('hold_debit', 'payout_freeze_debit');
  IF v_debit THEN
    UPDATE public.customer_wallets wallet
      SET available_balance = wallet.available_balance - v_amount, updated_at = pg_catalog.clock_timestamp()
      WHERE wallet.customer_id = v_transfer.customer_id AND wallet.merchant_id = v_merchant
        AND wallet.available_balance >= v_amount
      RETURNING wallet.id, wallet.available_balance INTO v_wallet_id, v_balance;
  ELSE
    INSERT INTO public.customer_wallets(customer_id, merchant_id, available_balance, total_earned)
      VALUES (v_transfer.customer_id, v_merchant, v_amount, 0)
      ON CONFLICT (customer_id) DO UPDATE
        SET available_balance = public.customer_wallets.available_balance + EXCLUDED.available_balance,
          updated_at = pg_catalog.clock_timestamp()
        WHERE public.customer_wallets.merchant_id = EXCLUDED.merchant_id
      RETURNING id, available_balance INTO v_wallet_id, v_balance;
  END IF;
  IF v_wallet_id IS NULL THEN
    IF p_inline AND v_debit THEN
      RAISE EXCEPTION 'insufficient_wallet_balance' USING ERRCODE = 'P0001';
    END IF;
    UPDATE piggyvest_primary.transfer_b_effects
      SET state = 'review', review_reason = CASE WHEN v_debit THEN 'insufficient_balance' ELSE 'wallet_mismatch' END
      WHERE id = p_effect_id;
    UPDATE piggyvest_primary.wallet_transfers SET effect_state = 'review'
      WHERE id = v_transfer.id AND effect_state = 'pending';
    RETURN 'review';
  END IF;
  INSERT INTO public.customer_wallet_transactions(id, wallet_id, customer_id, merchant_id, type, amount,
    balance_after, source_type, source_id, status, description, metadata)
  VALUES (v_ledger, v_wallet_id, v_transfer.customer_id, v_merchant, CASE WHEN v_debit THEN 'debit' ELSE 'credit' END,
    v_amount, v_balance, 'piggyvest_primary_' || v_effect.effect, v_effect.id, 'completed',
    CASE v_effect.effect
      WHEN 'hold_debit' THEN 'Wallet payment'
      WHEN 'release_credit' THEN 'Wallet payment released'
      WHEN 'unpaid_restore' THEN 'Unpaid order returned'
      WHEN 'refund_netted' THEN 'Refund'
      WHEN 'confirm_credit' THEN 'Wallet credit'
      WHEN 'payout_freeze_debit' THEN 'Support payout'
      ELSE 'Support payout returned' END,
    pg_catalog.jsonb_build_object('transferId', v_transfer.id, 'kind', v_transfer.kind, 'effect', v_effect.effect));
  UPDATE piggyvest_primary.transfer_b_effects
    SET state = 'applied', applied_by_login = SESSION_USER, applied_at = pg_catalog.clock_timestamp(),
      wallet_transaction_id = v_ledger
    WHERE id = p_effect_id;
  RETURN 'applied';
END $$;

CREATE FUNCTION piggyvest_primary.request_b_effect(p_transfer_id uuid, p_effect text, p_amount_kobo bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_transfer piggyvest_primary.wallet_transfers%ROWTYPE;
  v_kind piggyvest_primary.transfer_kinds%ROWTYPE;
  v_existing piggyvest_primary.transfer_b_effects%ROWTYPE;
  v_family uuid;
  v_states text[];
  v_debit bigint;
  v_credits bigint;
  v_review text;
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF p_transfer_id IS NULL OR p_effect IS NULL OR p_amount_kobo IS NULL
    OR p_amount_kobo NOT BETWEEN 1 AND 9999999999 THEN
    RAISE EXCEPTION 'invalid B effect request' USING ERRCODE = '22023';
  END IF;
  SELECT transfer.* INTO v_transfer FROM piggyvest_primary.wallet_transfers transfer WHERE transfer.id = p_transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown transfer' USING ERRCODE = '22023'; END IF;
  SELECT kind.* INTO v_kind FROM piggyvest_primary.transfer_kinds kind WHERE kind.kind = v_transfer.kind;
  IF NOT (p_effect = ANY (v_kind.b_effects)) OR (p_effect = 'refund_netted' AND v_transfer.purpose <> 'refund') THEN
    RAISE EXCEPTION 'B effect % is not allowed for %', p_effect, v_transfer.kind USING ERRCODE = '22023';
  END IF;
  v_family := CASE WHEN v_transfer.kind = 'collect' THEN v_transfer.id ELSE v_transfer.refund_of END;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'piggyvest-primary:b-family:' || COALESCE(v_family, v_transfer.id)::text, 0));
  SELECT effect.* INTO v_existing FROM piggyvest_primary.transfer_b_effects effect
    WHERE effect.transfer_id = p_transfer_id AND effect.effect = p_effect;
  IF FOUND THEN
    RETURN CASE WHEN v_existing.amount_kobo <> p_amount_kobo THEN 'conflict'
      WHEN v_existing.state = 'review' THEN 'review' ELSE 'duplicate' END;
  END IF;
  SELECT transfer.* INTO v_transfer FROM piggyvest_primary.wallet_transfers transfer WHERE transfer.id = p_transfer_id;
  v_states := CASE p_effect
    WHEN 'hold_debit' THEN ARRAY['held'] WHEN 'payout_freeze_debit' THEN ARRAY['ready']
    WHEN 'release_credit' THEN ARRAY['cancelled'] WHEN 'unpaid_restore' THEN ARRAY['failed_unpaid']
    WHEN 'refund_netted' THEN ARRAY['netted'] WHEN 'confirm_credit' THEN ARRAY['confirmed']
    ELSE ARRAY['failed_unpaid', 'cancelled'] END;
  IF NOT (v_transfer.state = ANY (v_states)) THEN
    RAISE EXCEPTION 'B effect % needs a transfer in %, not %', p_effect, v_states, v_transfer.state
      USING ERRCODE = '55000';
  END IF;
  IF p_effect IN ('hold_debit', 'payout_freeze_debit') THEN
    IF p_amount_kobo <> v_transfer.amount_kobo THEN
      RAISE EXCEPTION 'a debit must be the full leg amount' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_family IS NOT NULL THEN
      SELECT COALESCE(sum(effect.amount_kobo) FILTER (WHERE effect.effect = 'hold_debit'), 0),
          COALESCE(sum(effect.amount_kobo) FILTER (WHERE effect.effect <> 'hold_debit'), 0)
        INTO v_debit, v_credits FROM piggyvest_primary.transfer_b_effects effect
        WHERE effect.family_collect = v_family AND effect.state IN ('requested', 'applied');
    ELSIF p_effect = 'payout_failed_restore' THEN
      SELECT COALESCE(sum(effect.amount_kobo) FILTER (WHERE effect.effect = 'payout_freeze_debit'), 0), 0
        INTO v_debit, v_credits FROM piggyvest_primary.transfer_b_effects effect
        WHERE effect.transfer_id = p_transfer_id AND effect.state IN ('requested', 'applied');
    ELSE
      v_debit := v_transfer.amount_kobo;
      v_credits := 0;
    END IF;
    IF v_debit = 0 THEN
      v_review := 'credit_without_debit';
    ELSIF v_credits + p_amount_kobo > v_debit THEN
      v_review := 'credit_above_debit';
    END IF;
  END IF;
  INSERT INTO piggyvest_primary.transfer_b_effects(id, transfer_id, family_collect, effect, amount_kobo, state,
    review_reason, requested_by_login)
  VALUES (v_id, p_transfer_id, v_family, p_effect, p_amount_kobo,
    CASE WHEN v_review IS NULL THEN 'requested' ELSE 'review' END, v_review, SESSION_USER);
  IF v_review IS NOT NULL THEN
    UPDATE piggyvest_primary.wallet_transfers SET effect_state = 'review'
      WHERE id = p_transfer_id AND effect_state = 'pending';
    RETURN 'review';
  END IF;
  IF p_effect <> 'payout_freeze_debit' AND piggyvest_primary.session_may_write_b() THEN
    RETURN piggyvest_primary.apply_b_effect(v_id, true);
  END IF;
  IF p_effect = 'hold_debit' THEN
    RAISE EXCEPTION 'b_effect_requires_engine_login' USING ERRCODE = '42501';
  END IF;
  RETURN 'requested';
END $$;

CREATE FUNCTION piggyvest_primary.apply_requested_b_effects(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_effect uuid;
  v_applied integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid apply limit' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM piggyvest_primary.transfer_authorities authority
    JOIN piggyvest_primary.integrations integration ON integration.id = authority.integration_id
    WHERE authority.capability = 'worker' AND authority.enabled AND integration.enabled
      AND authority.executor_login = SESSION_USER) THEN
    RAISE EXCEPTION 'transfer worker authority unavailable' USING ERRCODE = '42501';
  END IF;
  FOR v_effect IN
    SELECT effect.id FROM piggyvest_primary.transfer_b_effects effect
      JOIN piggyvest_primary.wallet_transfers transfer ON transfer.id = effect.transfer_id
      JOIN piggyvest_primary.transfer_authorities authority ON authority.integration_id = transfer.integration_id
        AND authority.capability = 'worker' AND authority.enabled AND authority.executor_login = SESSION_USER
      JOIN piggyvest_primary.integrations integration ON integration.id = transfer.integration_id AND integration.enabled
      WHERE effect.state = 'requested'
      ORDER BY effect.created_at, effect.id
      LIMIT p_limit
      FOR UPDATE OF effect SKIP LOCKED
  LOOP
    -- One effect that cannot be applied must not stop the others: a lock or
    -- serialization conflict is left requested for a later pass; any other
    -- error moves the effect and its transfer to review. Locks taken by this
    -- loop's own row lock survive the inner rollback.
    BEGIN
      IF piggyvest_primary.apply_b_effect(v_effect, false) = 'applied' THEN
        v_applied := v_applied + 1;
      END IF;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
        NULL;
      WHEN OTHERS THEN
        UPDATE piggyvest_primary.transfer_b_effects SET state = 'review', review_reason = 'apply_failed:' || SQLSTATE
          WHERE id = v_effect AND state = 'requested';
        UPDATE piggyvest_primary.wallet_transfers transfer SET effect_state = 'review'
          FROM piggyvest_primary.transfer_b_effects effect
          WHERE effect.id = v_effect AND transfer.id = effect.transfer_id AND transfer.effect_state = 'pending';
    END;
  END LOOP;
  RETURN v_applied;
END $$;

REVOKE ALL ON FUNCTION piggyvest_primary.apply_b_effect(uuid, boolean),
  piggyvest_primary.request_b_effect(uuid, text, bigint), piggyvest_primary.apply_requested_b_effects(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.apply_requested_b_effects(integer) TO piggyvest_primary_transfer_worker;
COMMIT;
