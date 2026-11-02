-- Part of piggyvest_primary_engine_schema.sql (\ir): the transfer-kind matrix.
-- Runs inside the entry file's transaction.

-- The declared matrix, row by row.
DO $$
DECLARE
  v_expected text := concat_ws(';',
    'collect:main>collection:hold_debit:none:unpaid_restore:f:t:f',
    'disbursement:collection>main:none:confirm_credit:none:f:f:f',
    'goal_forfeit:goal>interest:none:none:none:t:f:f',
    'goal_leftover:goal>main:none:confirm_credit:none:t:f:f',
    'goal_purchase:goal>collection:none:none:none:t:t:f',
    'goal_refund:goal>main:none:confirm_credit:none:t:f:f',
    'goal_sweep:goal>main:none:confirm_credit:none:t:f:f',
    'interest_sweep:main>interest:none:none:none:f:f:t',
    'legacy_goal_migration:collection>goal:none:none:none:f:f:f',
    'legacy_migration:collection>main:none:none:none:f:f:f',
    'support_payout:main>bank:payout_freeze_debit:none:payout_failed_restore:f:f:f',
    'treasury_sweep:collection>bank:none:none:none:f:f:f');
  v_actual text;
BEGIN
  SELECT string_agg(format('%s:%s>%s:%s:%s:%s:%s:%s:%s', kind, source_role, destination_role,
      b_on_open, b_on_confirm, b_on_bound_failure,
      CASE WHEN requires_exit_claim THEN 't' ELSE 'f' END, CASE WHEN holdable THEN 't' ELSE 'f' END,
      CASE WHEN approval_only THEN 't' ELSE 'f' END), ';' ORDER BY kind COLLATE "C")
    INTO v_actual FROM piggyvest_primary.transfer_kinds;
  PERFORM pg_temp.check(v_actual = v_expected, format('transfer kind matrix drifted: %s', v_actual));
  PERFORM pg_temp.check((SELECT b_on_confirm = 'none' AND b_effects = '{}'::text[]
    FROM piggyvest_primary.transfer_kinds WHERE kind = 'legacy_migration'),
    'legacy_migration must never credit B: its money is already in B');
  PERFORM pg_temp.check((SELECT purposes FROM piggyvest_primary.transfer_kinds WHERE kind = 'collect')
    = ARRAY['vtu', 'imei', 'checkout'], 'collect purposes drifted');
  PERFORM pg_temp.check((SELECT purposes FROM piggyvest_primary.transfer_kinds WHERE kind = 'goal_forfeit')
    = ARRAY['cancel_interest', 'post_exit_interest'], 'goal_forfeit purposes drifted');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'UPDATE piggyvest_primary.transfer_kinds SET b_on_confirm = ''confirm_credit'' WHERE kind = ''legacy_migration''') = '42501',
    'the matrix must be immutable after the migration');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'INSERT INTO piggyvest_primary.transfer_kinds SELECT ''collect_two'', source_role, destination_role, purposes,
       delivery_modes, requires_exit_claim, holdable, approval_only, b_on_open, b_on_confirm, b_on_bound_failure,
       b_effects, r1_class, hook_owner FROM piggyvest_primary.transfer_kinds WHERE kind = ''collect''') = '42501',
    'kinds must not be added after the migration');
  PERFORM pg_temp.check(pg_temp.sqlstate_of('DELETE FROM piggyvest_primary.transfer_kinds WHERE kind = ''collect''') = '42501',
    'kinds must not be removed');
END $$;

-- Every declared row is accepted.
DO $$
DECLARE
  v_collect uuid;
BEGIN
  v_collect := pg_temp.wt('collect', 'vtu', 'deliver_before_collect', 'm-collect-vtu');
  PERFORM pg_temp.wt('collect', 'imei', 'deliver_before_collect', 'm-collect-imei', 'held');
  PERFORM pg_temp.wt('collect', 'checkout', 'deliver_after_confirm', 'm-collect-checkout', 'held');
  PERFORM pg_temp.wt('disbursement', 'refund', 'credit_main', 'm-refund', 'awaiting_collect', 5000,
    jsonb_build_object('refundOf', v_collect));
  PERFORM pg_temp.wt('disbursement', 'obligation', 'credit_main', 'm-obligation', 'awaiting_float');
  PERFORM pg_temp.wt('legacy_migration', 'legacy_balance', 'credit_main', 'm-legacy');
  PERFORM pg_temp.wt('legacy_goal_migration', 'legacy_goal_balance', 'credit_goal', 'm-legacy-goal');
  PERFORM pg_temp.wt('goal_purchase', 'checkout', 'deliver_after_confirm', 'm-goal-purchase', 'held');
  PERFORM pg_temp.wt('goal_refund', 'cancel', 'credit_main', 'm-goal-refund');
  PERFORM pg_temp.wt('goal_leftover', 'leftover', 'credit_main', 'm-goal-leftover');
  PERFORM pg_temp.wt('goal_sweep', 'retire_sweep', 'credit_main', 'm-goal-sweep');
  PERFORM pg_temp.wt('goal_forfeit', 'cancel_interest', 'credit_house', 'm-forfeit-cancel');
  PERFORM pg_temp.wt('goal_forfeit', 'post_exit_interest', 'credit_house', 'm-forfeit-post-exit');
  PERFORM pg_temp.wt('support_payout', 'support_payout', 'bank_payout', 'm-support-payout');
  PERFORM pg_temp.wt('treasury_sweep', 'treasury', 'bank_payout', 'm-treasury');
  PERFORM pg_temp.check((SELECT source_wallet_id || '>' || destination_wallet_id
    FROM piggyvest_primary.wallet_transfers WHERE id = v_collect) = 'pv-engine-main>pv-house-collection',
    'a collect must pin the customer main wallet and the collection wallet');
  PERFORM pg_temp.check((SELECT source_wallet_id || '>' || destination_wallet_id FROM piggyvest_primary.wallet_transfers
    WHERE source_ref = 'm-forfeit-cancel') = 'pv-engine-goal>pv-house-interest',
    'a forfeit must move from the goal wallet to the interest wallet');
  PERFORM pg_temp.check((SELECT destination_wallet_id IS NULL AND bank_destination_id = pg_temp.id(41)
    FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-treasury'),
    'a treasury sweep must pay the registered treasury account');
  PERFORM pg_temp.check((SELECT outstanding_kobo = amount_kobo AND row_version = 1 AND effect_state = 'pending'
    FROM piggyvest_primary.wallet_transfers WHERE id = v_collect), 'a new transfer starts fully outstanding at version 1');
END $$;

-- Every other (kind, source, destination) is rejected.
DO $$
DECLARE
  v_kind text;
  v_source text;
  v_destination text;
  v_state text;
  v_roles text[] := ARRAY['main', 'goal', 'collection', 'interest', 'fee', 'bank'];
BEGIN
  FOR v_kind IN SELECT kind FROM piggyvest_primary.transfer_kinds LOOP
    FOREACH v_source IN ARRAY v_roles LOOP
      FOREACH v_destination IN ARRAY v_roles LOOP
        CONTINUE WHEN EXISTS (SELECT 1 FROM piggyvest_primary.transfer_kinds
          WHERE kind = v_kind AND source_role = v_source AND destination_role = v_destination);
        v_state := pg_temp.sqlstate_of(format(
          'SELECT pg_temp.wt(%L, (SELECT purposes[1] FROM piggyvest_primary.transfer_kinds WHERE kind = %L),
             (SELECT delivery_modes[1] FROM piggyvest_primary.transfer_kinds WHERE kind = %L), %L, %L, 100,
             jsonb_build_object(''source'', %L, ''destination'', %L, ''refundOf'', %L))',
          v_kind, v_kind, v_kind, 'm-off-' || v_kind || '-' || v_source || '-' || v_destination, 'ready',
          v_source, v_destination, (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-collect-vtu')));
        PERFORM pg_temp.check(v_state = '23503',
          format('%s from %s to %s must be rejected by the matrix, got %s', v_kind, v_source, v_destination, v_state));
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- Purposes, delivery modes, duplicates, holds and exit claims.
DO $$
DECLARE
  v_collect uuid := (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-collect-vtu');
BEGIN
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''collect'', ''airtime'', ''deliver_before_collect'', ''m-bad-purpose'')') = '23514',
    'a purpose outside the kind must be refused');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''collect'', ''vtu'', ''credit_main'', ''m-bad-mode'')') = '23514',
    'a delivery mode outside the kind must be refused');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''collect'', ''checkout'', ''deliver_before_collect'', ''m-ship-early'')') = '23514',
    'physical goods must ship only after the collect is confirmed');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''collect'', ''vtu'', ''deliver_after_confirm'', ''m-vtu-late'')') = '23514',
    'airtime is delivered before its collect');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''collect'', ''imei'', ''deliver_before_collect'', ''m-collect-vtu'')') = '23505',
    'a second transfer of one kind for one source must be refused');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''disbursement'', ''obligation'', ''credit_main'', ''m-held-disbursement'', ''held'')') = '23514',
    'only collect and goal_purchase legs may be held');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''goal_refund'', ''cancel'', ''credit_main'', ''m-no-claim'', ''ready'', 100, ''{"noClaim":true}'')') = '23514',
    'a goal exit leg without an exit claim must be refused');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''disbursement'', ''refund'', ''credit_main'', ''m-orphan-refund'')') = '23514',
    'a refund must name the collect it refunds');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'SELECT pg_temp.wt(''disbursement'', ''obligation'', ''credit_main'', ''m-obligation-refund'', ''ready'', 100,
       jsonb_build_object(''refundOf'', %L))', v_collect)) = '23514',
    'only a refund may name a collect');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'SELECT pg_temp.wt(''disbursement'', ''refund'', ''credit_main'', ''m-refund-of-refund'', ''ready'', 100,
       jsonb_build_object(''refundOf'', %L))', (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-refund'))) = '23514',
    'a refund must refund a collect or a goal purchase, never another refund');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''collect'', ''vtu'', ''deliver_before_collect'', ''m-foreign-customer'', ''ready'', 100, ''{"customer":"e5e00000-0000-4000-8000-000000000013"}'')') = '23514',
    'a customer of another merchant must be refused');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''collect'', ''vtu'', ''deliver_before_collect'', ''m-no-wallet'', ''ready'', 100, ''{"customer":"e5e00000-0000-4000-8000-000000000004"}'')') = '23514',
    'a customer without a verified main wallet must be refused');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'SELECT pg_temp.wt(''collect'', ''vtu'', ''deliver_before_collect'', ''m-confirmed-at-birth'', ''confirmed'')') = '23514',
    'a transfer must not be created in a settled state');
  -- A customer wallet that is also a registered house wallet is refused at the
  -- point of money movement too (the reverse of the registry's own check).
  UPDATE piggyvest_primary.onboarding_intents SET provider_wallet_id = 'pv-house-collection' WHERE id = pg_temp.id(6);
  PERFORM pg_temp.check(pg_temp.error_of(
    'SELECT pg_temp.wt(''collect'', ''vtu'', ''deliver_before_collect'', ''m-house-as-main'')') LIKE '%house wallet%',
    'a house wallet must never act as a customer wallet');
  UPDATE piggyvest_primary.onboarding_intents SET provider_wallet_id = 'pv-engine-main' WHERE id = pg_temp.id(6);
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.wallet_transfers(integration_id, kind, source_role, destination_role, purpose,
       delivery_mode, source_ref, customer_id, source_wallet_id, amount_kobo, state)
     VALUES (%L, ''collect'', ''main'', ''collection'', ''vtu'', ''deliver_before_collect'', ''m-wrong-wallet'', %L,
       ''pv-somebody-else'', 100, ''ready'')', pg_temp.id(5), pg_temp.id(3))) = '23514',
    'a caller-supplied wallet id must match the resolved wallet');
END $$;

-- A goal purchase is refunded Collection -> main like a collect.
SELECT pg_temp.check(pg_temp.sqlstate_of(format(
  'SELECT pg_temp.wt(''disbursement'', ''refund'', ''credit_main'', ''m-goal-purchase-refund'', ''awaiting_collect'', 4000,
     jsonb_build_object(''refundOf'', %L))',
  (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-goal-purchase'))) = 'ok',
  'a goal purchase must be refundable to the main wallet');

-- Kill switches: a disabled goal mapping, or a goal whose owner's main
-- wallet is not verified, moves no money; nor does a house wallet that a
-- customer record also claims.
SAVEPOINT engine_matrix_switches;
UPDATE piggyvest_primary.savings_destinations SET enabled = false WHERE goal_id = pg_temp.id(21);
SELECT pg_temp.check(pg_temp.error_of(
  'SELECT pg_temp.wt(''goal_refund'', ''cancel'', ''credit_main'', ''m-disabled-goal'')') LIKE '%goal wallet unavailable%'
  AND pg_temp.error_of(
  'SELECT pg_temp.wt(''goal_forfeit'', ''cancel_interest'', ''credit_house'', ''m-disabled-goal'')') LIKE '%goal wallet unavailable%'
  AND pg_temp.error_of(
  'SELECT pg_temp.wt(''legacy_goal_migration'', ''legacy_goal_balance'', ''credit_goal'', ''m-disabled-goal'')')
    LIKE '%goal wallet unavailable%',
  'a disabled goal mapping must not move money in or out');
ROLLBACK TO SAVEPOINT engine_matrix_switches;
SAVEPOINT engine_matrix_switches;
UPDATE piggyvest_primary.onboarding_intents SET state = 'accepted' WHERE id = pg_temp.id(6);
SELECT pg_temp.check(pg_temp.error_of(
  'SELECT pg_temp.wt(''goal_forfeit'', ''cancel_interest'', ''credit_house'', ''m-unverified-goal'')')
    LIKE '%goal wallet unavailable%',
  'a goal whose owner is not verified must not move money');
ROLLBACK TO SAVEPOINT engine_matrix_switches;
SAVEPOINT engine_matrix_switches;
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
VALUES (pg_temp.id(7), pg_temp.id(5), pg_temp.id(2), pg_temp.id(4), pg_temp.id(1),
  repeat('a', 64), 'verified', 'pv-engine-customer-4', 'pv-house-interest');
SELECT pg_temp.check(pg_temp.error_of(
  'SELECT pg_temp.wt(''goal_forfeit'', ''cancel_interest'', ''credit_house'', ''m-claimed-house'')')
    LIKE '%customer record claims%',
  'a house wallet that a customer record claims must take no money');
SELECT pg_temp.check(pg_temp.sqlstate_of(
  'SELECT pg_temp.wt(''collect'', ''vtu'', ''deliver_before_collect'', ''m-unclaimed-house'')') = 'ok',
  'an unclaimed house wallet still takes money');
ROLLBACK TO SAVEPOINT engine_matrix_switches;

-- A house wallet is registered for one business. When the integration's
-- business changes, a wallet that is still enabled moves no money until it is
-- registered again: every house leg checks the business at creation.
SAVEPOINT engine_matrix_business;
UPDATE piggyvest_primary.integrations SET business_id = 'engine-business-renamed' WHERE id = pg_temp.id(5);
SELECT pg_temp.check(pg_temp.error_of(
  'SELECT pg_temp.wt(''collect'', ''vtu'', ''deliver_before_collect'', ''m-stale-business-in'')')
    LIKE '%collection wallet unavailable%'
  AND pg_temp.error_of(
  'SELECT pg_temp.wt(''disbursement'', ''obligation'', ''credit_main'', ''m-stale-business-out'', ''awaiting_float'')')
    LIKE '%collection wallet unavailable%'
  AND pg_temp.error_of(
  'SELECT pg_temp.wt(''goal_forfeit'', ''cancel_interest'', ''credit_house'', ''m-stale-business-interest'')')
    LIKE '%interest wallet unavailable%',
  'a house wallet of the integration''s previous business must take no money');
ROLLBACK TO SAVEPOINT engine_matrix_business;
SELECT pg_temp.check(pg_temp.sqlstate_of(
  'SELECT pg_temp.wt(''collect'', ''vtu'', ''deliver_before_collect'', ''m-same-business'')') = 'ok',
  'a house wallet of the integration''s own business still takes money');
