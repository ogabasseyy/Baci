\set ON_ERROR_STOP on
\if :{?test_goal_id}
\else
\echo 'test_goal_id must identify an active legacy goal in the scratch database'
\quit 3
\endif

BEGIN;
SELECT pg_catalog.set_config('baci.piggyvest_projection_test', 'on', true);
\set piggyvest_projection_test 1
\ir projection.sql

CREATE TEMP TABLE projection_test_context ON COMMIT DROP AS
SELECT mapping.integration_id, mapping.provider_wallet_id, mapping.provider_customer_id,
  mapping.merchant_id, mapping.customer_id, mapping.goal_id,
  goal.current_amount AS initial_amount, goal.target_amount,
  (SELECT count(*) FROM public.customer_wallet_transactions AS transaction_row
   WHERE transaction_row.customer_id = mapping.customer_id) AS wallet_transaction_count
FROM piggyvest_staging.wallet_goal_mappings AS mapping
JOIN public.customer_savings_goals AS goal
  ON goal.id = mapping.goal_id AND goal.merchant_id = mapping.merchant_id
    AND goal.customer_id = mapping.customer_id
WHERE mapping.goal_id = :'test_goal_id'::uuid
  AND mapping.integration_id = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
  AND goal.goal_kind = 'legacy' AND goal.source_mode = 'manual'
  AND goal.status = 'active';

CREATE TEMP TABLE public_mapping_test_context ON COMMIT DROP AS
SELECT mapping.piggyvest_customer_id, mapping.wallet_id
FROM public.piggyvest_plan_wallets AS mapping
WHERE NOT EXISTS (
  SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS private_mapping
  WHERE private_mapping.provider_wallet_id = mapping.wallet_id
)
ORDER BY mapping.wallet_id
LIMIT 1;

DO $fixture_guard$
BEGIN
  IF (SELECT count(*) FROM projection_test_context) <> 1 THEN
    RAISE EXCEPTION 'scratch fixture must resolve to exactly one active legacy goal mapping';
  END IF;
  IF (SELECT count(*) FROM public_mapping_test_context) <> 1 THEN
    RAISE EXCEPTION 'scratch fixture must include a public-only plan-wallet mapping';
  END IF;
END
$fixture_guard$;

DO $projection_assertions$
DECLARE
  v_context record;
  v_transaction_id text := 'scratch-piggyvest-' || pg_catalog.txid_current()::text;
  v_event_data_id text := 'scratch-data-' || pg_catalog.txid_current()::text;
  v_event_id text := 'scratch-event-' || pg_catalog.txid_current()::text;
  v_result text;
  v_overflow_kobo bigint;
  v_completion_kobo bigint;
BEGIN
  SELECT integration_id, provider_wallet_id, provider_customer_id, merchant_id,
    customer_id, goal_id, initial_amount, target_amount, wallet_transaction_count
  INTO STRICT v_context FROM projection_test_context;

  IF (SELECT count(*) FROM public.resolve_piggyvest_staging_goal_mapping(
        v_context.provider_customer_id, v_context.provider_wallet_id
      )) <> 1 THEN
    RAISE EXCEPTION 'private goal mapping resolver did not return exactly one row';
  END IF;
  IF (SELECT count(*) FROM public.resolve_piggyvest_staging_goal_mapping(
        'wrong-scratch-customer', v_context.provider_wallet_id
      )) <> 0 THEN
    RAISE EXCEPTION 'private resolver accepted a wallet for the wrong customer';
  END IF;
  IF (SELECT count(*) FROM public.resolve_piggyvest_staging_goal_mapping(
        'wrong-scratch-customer', 'scratch-public-wallet'
      )) <> 0 THEN
    RAISE EXCEPTION 'public resolver accepted a wallet for the wrong customer';
  END IF;

  v_result := public.recognize_piggyvest_staging_inflow(
    v_transaction_id, v_event_data_id, v_event_id,
    v_context.provider_customer_id, v_context.provider_wallet_id,
    1, 0, 'scratch-reference', NULL, pg_catalog.clock_timestamp()
  );
  IF v_result <> 'recognized' THEN
    RAISE EXCEPTION 'first confirmed receipt was not recognized';
  END IF;

  IF (SELECT current_amount FROM public.customer_savings_goals WHERE id = v_context.goal_id)
      <> v_context.initial_amount + 0.01
    OR (SELECT count(*) FROM piggyvest_staging.goal_inflow_projections
        WHERE provider_transaction_id = v_transaction_id) <> 1
    OR (SELECT count(*) FROM public.customer_savings_contributions
        WHERE idempotency_key = 'piggyvest:' || v_transaction_id
          AND goal_id = v_context.goal_id AND source_type = 'piggyvest_inflow'
          AND status = 'completed' AND wallet_transaction_id IS NULL AND transaction_id IS NULL) <> 1
    OR (SELECT count(*) FROM public.customer_wallet_transactions
        WHERE customer_id = v_context.customer_id) <> v_context.wallet_transaction_count THEN
    RAISE EXCEPTION 'projection did not create exactly one goal-only contribution';
  END IF;

  v_result := public.recognize_piggyvest_staging_inflow(
    v_transaction_id, v_event_data_id, v_event_id,
    v_context.provider_customer_id, v_context.provider_wallet_id,
    1, 0, 'scratch-reference', NULL,
    (SELECT credited_at FROM piggyvest_staging.goal_inflow_projections
      WHERE provider_transaction_id = v_transaction_id)
  );
  IF v_result <> 'duplicate'
    OR (SELECT current_amount FROM public.customer_savings_goals WHERE id = v_context.goal_id)
      <> v_context.initial_amount + 0.01 THEN
    RAISE EXCEPTION 'duplicate receipt changed the goal projection';
  END IF;

  BEGIN
    PERFORM public.recognize_piggyvest_staging_inflow(
      v_transaction_id, v_event_data_id, v_event_id,
      v_context.provider_customer_id, v_context.provider_wallet_id,
      2, 0, 'scratch-reference', NULL,
      (SELECT credited_at FROM piggyvest_staging.goal_inflow_projections
        WHERE provider_transaction_id = v_transaction_id)
    );
    RAISE EXCEPTION 'conflicting provider transaction was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    PERFORM public.recognize_piggyvest_staging_inflow(
      v_transaction_id || '-fee', v_event_data_id || '-fee', v_event_id || '-fee',
      v_context.provider_customer_id, v_context.provider_wallet_id,
      1, 1, 'scratch-fee-reference', 'scratch-session', pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'nonzero provider fee was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  v_overflow_kobo := pg_catalog.ceil(
    (v_context.target_amount - v_context.initial_amount) * 100
  )::bigint + 1;
  BEGIN
    PERFORM public.recognize_piggyvest_staging_inflow(
      v_transaction_id || '-overflow', v_event_data_id || '-overflow', v_event_id || '-overflow',
      v_context.provider_customer_id, v_context.provider_wallet_id,
      v_overflow_kobo, 0, 'scratch-overflow-reference', 'scratch-session',
      pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'over-target provider receipt was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.piggyvest_inflow_credits
      WHERE provider_transaction_id IN (v_transaction_id || '-fee', v_transaction_id || '-overflow'))
    OR (SELECT current_amount FROM public.customer_savings_goals WHERE id = v_context.goal_id)
      <> v_context.initial_amount + 0.01 THEN
    RAISE EXCEPTION 'rejected receipt left partial evidence or changed the goal';
  END IF;

  v_completion_kobo := ((v_context.target_amount - v_context.initial_amount - 0.01) * 100)::bigint;
  v_result := public.recognize_piggyvest_staging_inflow(
    v_transaction_id || '-completion', v_event_data_id || '-completion', v_event_id || '-completion',
    v_context.provider_customer_id, v_context.provider_wallet_id,
    v_completion_kobo, 0, 'scratch-completion-reference', NULL, pg_catalog.clock_timestamp()
  );
  IF v_result <> 'recognized'
    OR (SELECT status FROM public.customer_savings_goals WHERE id = v_context.goal_id) <> 'completed' THEN
    RAISE EXCEPTION 'inflow reaching target did not complete the legacy goal';
  END IF;
  v_result := public.recognize_piggyvest_staging_inflow(
    v_transaction_id || '-completion', v_event_data_id || '-completion', v_event_id || '-completion',
    v_context.provider_customer_id, v_context.provider_wallet_id,
    v_completion_kobo, 0, 'scratch-completion-reference', NULL,
    (SELECT credited_at FROM piggyvest_staging.goal_inflow_projections
      WHERE provider_transaction_id = v_transaction_id || '-completion')
  );
  IF v_result <> 'duplicate'
    OR (SELECT current_amount FROM public.customer_savings_goals WHERE id = v_context.goal_id)
      <> v_context.target_amount THEN
    RAISE EXCEPTION 'completed goal duplicate receipt was not idempotent';
  END IF;

  BEGIN
    PERFORM public.recognize_piggyvest_staging_inflow(
      v_transaction_id || '-old-probe', v_event_data_id || '-old-probe', v_event_id || '-old-probe',
      v_context.provider_customer_id, '01M2T3PCEDE2MGF2S7Y5T49H01',
      1, 0, 'scratch-old-probe-reference', 'scratch-session', pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'old public probe wallet was accepted for the private goal';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.piggyvest_inflow_credits
      WHERE provider_transaction_id = v_transaction_id || '-old-probe') THEN
    RAISE EXCEPTION 'old public probe left inflow evidence';
  END IF;

  SELECT mapping.piggyvest_customer_id, mapping.wallet_id
  INTO STRICT v_context
  FROM public_mapping_test_context AS context
  JOIN public.piggyvest_plan_wallets AS mapping
    ON mapping.wallet_id = context.wallet_id
      AND mapping.piggyvest_customer_id = context.piggyvest_customer_id;
  v_result := public.recognize_piggyvest_staging_inflow(
    v_transaction_id || '-public', v_event_data_id || '-public', v_event_id || '-public',
    v_context.piggyvest_customer_id, v_context.wallet_id,
    1, 0, 'scratch-public-reference', NULL, pg_catalog.clock_timestamp()
  );
  IF v_result <> 'recognized'
    OR NOT EXISTS (SELECT 1 FROM public.piggyvest_inflow_credits
      WHERE provider_transaction_id = v_transaction_id || '-public')
    OR EXISTS (SELECT 1 FROM piggyvest_staging.goal_inflow_projections
      WHERE provider_transaction_id = v_transaction_id || '-public')
    OR (SELECT current_amount FROM public.customer_savings_goals
        WHERE id = (SELECT goal_id FROM projection_test_context))
      <> (SELECT target_amount FROM projection_test_context) THEN
    RAISE EXCEPTION 'public-only receipt did not remain ledger-only';
  END IF;
END
$projection_assertions$;

ROLLBACK;
