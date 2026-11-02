-- Wallet backing transitions (state store: 20261102033304). Every transition
-- takes the per-customer lock exclusively (assert_wallet_legacy takes it
-- shared), then the backing row, then the wallet row, in that order.
--
--   begin_migration      legacy -> migrating for an audited, settled,
--                        non-zero balance; legacy -> backed for an audited
--                        zero (or no wallet row). Writes no wallet or ledger row.
--   flip_to_backed       migrating -> backed after the move transfer is
--                        confirmed. Owner-only: the transfer engine calls it
--                        from its own SECURITY DEFINER settle, so no session can
--                        flip a wallet without a confirmed move.
--   flag_migration_review records a review reason without changing the state.
--
-- Refusals of bad input raise with a stable message; outcomes a caller must
-- record (a refused or reviewed flip) are returned, never raised, so a
-- confirmed transfer is never rolled back by the flip.
BEGIN;

CREATE FUNCTION piggyvest_primary.flag_migration_review(p_customer_id uuid, p_merchant_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_backing piggyvest_primary.wallet_backing%ROWTYPE;
  v_found boolean;
BEGIN
  IF p_customer_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'wallet_backing_scope_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION 'wallet_backing_invalid_review_reason' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('piggyvest-wallet-backing:' || p_customer_id::text, 0));
  -- An existing row is flagged where it stands (its merchant is the scope), so
  -- the flip's review paths never raise; only a new row needs the customer to
  -- still belong to the merchant.
  SELECT * INTO v_backing FROM piggyvest_primary.wallet_backing b
  WHERE b.customer_id = p_customer_id FOR UPDATE;
  v_found := FOUND;
  IF v_found AND v_backing.merchant_id <> p_merchant_id THEN
    RAISE EXCEPTION 'wallet_backing_scope_unavailable' USING ERRCODE = '42501';
  ELSIF v_found THEN
    UPDATE piggyvest_primary.wallet_backing
    SET review_reason = p_reason, review_flagged_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_backing.id RETURNING * INTO v_backing;
  ELSE
    PERFORM 1 FROM public.customers c
    WHERE c.id = p_customer_id AND c.merchant_id = p_merchant_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'wallet_backing_scope_unavailable' USING ERRCODE = '42501';
    END IF;
    INSERT INTO piggyvest_primary.wallet_backing(merchant_id, customer_id, state, review_reason, review_flagged_at)
    VALUES (p_merchant_id, p_customer_id, 'legacy', p_reason, pg_catalog.clock_timestamp())
    RETURNING * INTO v_backing;
  END IF;
  INSERT INTO piggyvest_primary.wallet_backing_events(backing_id, event, from_state, to_state, reason)
  VALUES (v_backing.id, 'review_flagged', v_backing.state, v_backing.state, p_reason);
  RETURN pg_catalog.jsonb_build_object('status', 'review', 'state', v_backing.state,
    'reason', p_reason, 'backingId', v_backing.id);
END $$;

CREATE FUNCTION piggyvest_primary.begin_migration(
  p_customer_id uuid, p_merchant_id uuid, p_intent_id uuid, p_audited_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  v_backing piggyvest_primary.wallet_backing%ROWTYPE;
  v_customer_user uuid;
  v_wallet_id uuid;
  v_wallet_merchant uuid;
  v_balance numeric;
  v_found boolean;
  v_target text;
BEGIN
  IF p_customer_id IS NULL OR p_merchant_id IS NULL OR p_intent_id IS NULL THEN
    RAISE EXCEPTION 'wallet_backing_scope_required' USING ERRCODE = '22023';
  END IF;
  -- The flip writes this amount to customer_wallet_transactions.amount
  -- (numeric(10,2)), so a balance that column cannot hold never begins.
  IF p_audited_amount IS NULL OR p_audited_amount < 0 OR p_audited_amount <> pg_catalog.round(p_audited_amount, 2)
    OR p_audited_amount >= 100000000 THEN
    RAISE EXCEPTION 'wallet_backing_invalid_amount' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('piggyvest-wallet-backing:' || p_customer_id::text, 0));
  -- FOR SHARE (not KEY SHARE) so a concurrent relink of user_id waits.
  SELECT c.user_id INTO v_customer_user FROM public.customers c
  WHERE c.id = p_customer_id AND c.merchant_id = p_merchant_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_backing_scope_unavailable' USING ERRCODE = '42501';
  END IF;
  -- The intent must still belong to the user the customer row names now.
  SELECT * INTO v_intent FROM piggyvest_primary.onboarding_intents i WHERE i.id = p_intent_id FOR SHARE;
  IF NOT FOUND OR v_intent.customer_id IS DISTINCT FROM p_customer_id OR v_intent.merchant_id <> p_merchant_id
    OR v_intent.user_id IS DISTINCT FROM v_customer_user THEN
    RAISE EXCEPTION 'wallet_backing_scope_unavailable' USING ERRCODE = '42501';
  END IF;
  -- Verified and still open: a closed provider account cannot receive the move.
  IF v_intent.state <> 'verified' OR v_intent.provider_closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'wallet_backing_unverified' USING ERRCODE = '55000';
  END IF;
  -- Nor can one behind a switched-off integration (the operator kill switch).
  PERFORM 1 FROM piggyvest_primary.integrations g
  WHERE g.id = v_intent.integration_id AND g.merchant_id = p_merchant_id AND g.enabled FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_backing_integration_disabled' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_backing FROM piggyvest_primary.wallet_backing b
  WHERE b.customer_id = p_customer_id FOR UPDATE;
  v_found := FOUND;
  IF v_found AND v_backing.merchant_id <> p_merchant_id THEN
    RAISE EXCEPTION 'wallet_backing_scope_unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_found AND v_backing.state = 'backed' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'backed', 'changed', false, 'backingId', v_backing.id);
  END IF;
  IF v_found AND v_backing.state = 'migrating' THEN
    IF v_backing.onboarding_intent_id <> p_intent_id THEN
      RAISE EXCEPTION 'wallet_backing_scope_unavailable' USING ERRCODE = '42501';
    END IF;
    IF v_backing.audited_amount <> p_audited_amount THEN
      RAISE EXCEPTION 'wallet_backing_amount_mismatch' USING ERRCODE = '22023';
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'migrating', 'changed', false, 'backingId', v_backing.id);
  END IF;

  -- The audited amount must equal the balance right now, under the wallet
  -- lock; no wallet row is a zero balance.
  SELECT w.id, w.merchant_id, w.available_balance INTO v_wallet_id, v_wallet_merchant, v_balance
  FROM public.customer_wallets w WHERE w.customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    v_balance := 0;
  ELSIF v_wallet_merchant <> p_merchant_id THEN
    RAISE EXCEPTION 'wallet_backing_scope_unavailable' USING ERRCODE = '42501';
  ELSIF v_balance IS NULL THEN
    RAISE EXCEPTION 'wallet_backing_balance_unavailable' USING ERRCODE = '55000';
  END IF;
  IF v_balance <> p_audited_amount THEN
    RAISE EXCEPTION 'wallet_backing_amount_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_wallet_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.customer_wallet_transactions t
    WHERE t.wallet_id = v_wallet_id AND t.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'wallet_backing_pending_ledger' USING ERRCODE = '55000';
  END IF;

  v_target := CASE WHEN p_audited_amount = 0 THEN 'backed' ELSE 'migrating' END;
  IF v_found THEN
    UPDATE piggyvest_primary.wallet_backing SET state = v_target, onboarding_intent_id = p_intent_id,
      audited_amount = p_audited_amount,
      migrating_at = CASE WHEN v_target = 'migrating' THEN pg_catalog.clock_timestamp() END,
      backed_via = CASE WHEN v_target = 'backed' THEN 'audited_zero' END,
      backed_at = CASE WHEN v_target = 'backed' THEN pg_catalog.clock_timestamp() END,
      updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_backing.id RETURNING * INTO v_backing;
  ELSE
    INSERT INTO piggyvest_primary.wallet_backing(merchant_id, customer_id, state, onboarding_intent_id,
      audited_amount, migrating_at, backed_via, backed_at)
    VALUES (p_merchant_id, p_customer_id, v_target, p_intent_id, p_audited_amount,
      CASE WHEN v_target = 'migrating' THEN pg_catalog.clock_timestamp() END,
      CASE WHEN v_target = 'backed' THEN 'audited_zero' END,
      CASE WHEN v_target = 'backed' THEN pg_catalog.clock_timestamp() END)
    RETURNING * INTO v_backing;
  END IF;
  INSERT INTO piggyvest_primary.wallet_backing_events(backing_id, event, from_state, to_state, amount)
  VALUES (v_backing.id, CASE WHEN v_target = 'backed' THEN 'backed_audited_zero' ELSE 'migration_begun' END,
    'legacy', v_target, p_audited_amount);
  RETURN pg_catalog.jsonb_build_object('status', v_target, 'changed', true, 'backingId', v_backing.id);
END $$;

CREATE FUNCTION piggyvest_primary.flip_to_backed(p_customer_id uuid, p_merchant_id uuid, p_move_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_backing piggyvest_primary.wallet_backing%ROWTYPE;
  v_found boolean;
  v_wallet_id uuid;
  v_wallet_merchant uuid;
  v_balance numeric;
  v_amount numeric(12,2);
  v_credit text;
  v_convert text;
BEGIN
  IF p_customer_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'wallet_backing_scope_required' USING ERRCODE = '22023';
  END IF;
  IF p_move_reference IS NULL OR p_move_reference !~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$' THEN
    RAISE EXCEPTION 'wallet_backing_invalid_move_reference' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('piggyvest-wallet-backing:' || p_customer_id::text, 0));
  SELECT * INTO v_backing FROM piggyvest_primary.wallet_backing b
  WHERE b.customer_id = p_customer_id FOR UPDATE;
  v_found := FOUND;
  IF v_found AND v_backing.merchant_id <> p_merchant_id THEN
    RAISE EXCEPTION 'wallet_backing_scope_unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_found AND v_backing.state = 'backed' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'backed', 'changed', false, 'backingId', v_backing.id);
  END IF;
  IF NOT v_found OR v_backing.state <> 'migrating' THEN
    -- Flag a recorded row, or a customer still at this merchant; a customer
    -- that is gone is refused without a flag, so the refusal never raises.
    IF NOT v_found THEN
      PERFORM 1 FROM public.customers c
      WHERE c.id = p_customer_id AND c.merchant_id = p_merchant_id FOR KEY SHARE;
      v_found := FOUND;
    END IF;
    IF v_found THEN
      PERFORM piggyvest_primary.flag_migration_review(p_customer_id, p_merchant_id, 'flip_not_migrating');
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'refused', 'reason', 'not_migrating');
  END IF;

  -- The balance must still be the audited amount and fully settled; anything
  -- else stays migrating for review. No wallet row is a zero balance.
  SELECT w.id, w.merchant_id, w.available_balance INTO v_wallet_id, v_wallet_merchant, v_balance
  FROM public.customer_wallets w WHERE w.customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    v_balance := 0;
  ELSIF v_wallet_merchant <> p_merchant_id THEN
    RAISE EXCEPTION 'wallet_backing_scope_unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_balance IS DISTINCT FROM v_backing.audited_amount THEN
    PERFORM piggyvest_primary.flag_migration_review(p_customer_id, p_merchant_id, 'flip_balance_mismatch');
    RETURN pg_catalog.jsonb_build_object('status', 'review', 'reason', 'balance_mismatch', 'backingId', v_backing.id);
  END IF;
  IF v_wallet_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.customer_wallet_transactions t
    WHERE t.wallet_id = v_wallet_id AND t.status = 'pending'
  ) THEN
    PERFORM piggyvest_primary.flag_migration_review(p_customer_id, p_merchant_id, 'flip_pending_ledger');
    RETURN pg_catalog.jsonb_build_object('status', 'review', 'reason', 'pending_ledger', 'backingId', v_backing.id);
  END IF;
  v_amount := v_backing.audited_amount;

  -- Backed first, so the relabel rows are written against a backed wallet.
  UPDATE piggyvest_primary.wallet_backing
  SET state = 'backed', backed_via = 'confirmed_move', move_reference = p_move_reference,
    backed_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_backing.id;
  -- The relabel pair: the same X leaves as legacy money and arrives as
  -- PiggyVest money. available_balance is not touched.
  IF v_amount > 0 THEN
    INSERT INTO public.customer_wallet_transactions(wallet_id, customer_id, merchant_id, type, amount,
      balance_after, source_type, source_id, status, description, metadata, created_at)
    VALUES (v_wallet_id, p_customer_id, p_merchant_id, 'adjustment', -v_amount, 0,
      'piggyvest_legacy_migration', v_backing.id, 'completed', 'Old wallet balance moved to PiggyVest',
      pg_catalog.jsonb_build_object('leg', 'legacy_out'), pg_catalog.clock_timestamp());
    INSERT INTO public.customer_wallet_transactions(wallet_id, customer_id, merchant_id, type, amount,
      balance_after, source_type, source_id, status, description, metadata, created_at)
    VALUES (v_wallet_id, p_customer_id, p_merchant_id, 'adjustment', v_amount, v_amount,
      'piggyvest_legacy_migration', v_backing.id, 'completed', 'Balance now held in your PiggyVest wallet',
      pg_catalog.jsonb_build_object('leg', 'piggyvest_in'), pg_catalog.clock_timestamp());
  END IF;
  INSERT INTO piggyvest_primary.wallet_backing_events(backing_id, event, from_state, to_state, amount, move_reference)
  VALUES (v_backing.id, 'backed_confirmed_move', 'migrating', 'backed', v_amount, p_move_reference);

  -- A failing hook rolls back only its own work: the flip stands and the
  -- wallet goes to review.
  BEGIN
    v_credit := piggyvest_primary.on_backed_flip_credit_deferred(v_backing.id);
  EXCEPTION WHEN OTHERS THEN
    v_credit := 'error';
  END;
  BEGIN
    v_convert := piggyvest_primary.on_backed_flip_convert_obligations(v_backing.id);
  EXCEPTION WHEN OTHERS THEN
    v_convert := 'error';
  END;
  IF v_credit = 'error' OR v_convert = 'error' THEN
    PERFORM piggyvest_primary.flag_migration_review(p_customer_id, p_merchant_id, 'flip_hook_error');
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'backed', 'changed', true, 'backingId', v_backing.id,
    'relabelledAmount', v_amount,
    'hooks', pg_catalog.jsonb_build_object('creditDeferred', v_credit, 'convertObligations', v_convert));
END $$;

REVOKE ALL ON FUNCTION piggyvest_primary.flag_migration_review(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.begin_migration(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.flip_to_backed(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.flag_migration_review(uuid, uuid, text) TO piggyvest_primary_ledger_ops;
GRANT EXECUTE ON FUNCTION piggyvest_primary.begin_migration(uuid, uuid, uuid, numeric) TO piggyvest_primary_ledger_ops;

COMMIT;
