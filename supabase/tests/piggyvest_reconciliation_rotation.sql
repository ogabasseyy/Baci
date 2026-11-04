-- Contract tests for the reconciliation index and rotation (task PE3): the two
-- supporting indexes exist with the expected columns, and the read rotates
-- over more than 500 wallets and more than 200 stuck transfers so consecutive
-- slots tile the whole list, with the deferred counts reported, never a silent
-- cut. Synthetic, transaction-local fixture.
BEGIN;
UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;
INSERT INTO auth.users (id, email) VALUES
  ('f3830000-0000-4000-8000-000000000001', 'piggyvest-recon-rotation@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3830000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3830000-0000-4000-8000-000000000002', 'f3830000-0000-4000-8000-000000000001',
   'piggyvest-recon-rotation@example.test', 'PiggyVest Recon Rotation Fixture', 'piggyvest-recon-rotation-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000002',
   'f3830000-0000-4000-8000-000000000001', 'piggyvest-recon-rotation-customer@example.test');
INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity) VALUES
  ('f3830000-0000-4000-8000-000000000004', 'f3830000-0000-4000-8000-000000000002',
   'Synthetic savings product', 10000, 'active', 1);
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES ('f3830000-0000-4000-8000-000000000005', 'f3830000-0000-4000-8000-000000000002',
   'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000004',
   'Synthetic rotation goal', 10000, 0, 1000, 'daily', current_date, current_date + 30,
   'manual', now(), now());
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3830000-0000-4000-8000-000000000006', 'f3830000-0000-4000-8000-000000000002',
  'synthetic-rotation-business', 'staging', SESSION_USER, true);
INSERT INTO piggyvest_primary.inflow_authorities (integration_id, executor_login, enabled)
VALUES ('f3830000-0000-4000-8000-000000000006', SESSION_USER, true);
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES ('f3830000-0000-4000-8000-000000000007', 'f3830000-0000-4000-8000-000000000006',
  'f3830000-0000-4000-8000-000000000002', 'f3830000-0000-4000-8000-000000000003',
  'f3830000-0000-4000-8000-000000000001', repeat('b', 64), 'accepted',
  'synthetic-rotation-customer', 'synthetic-main-wallet');
INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
  ('f3830000-0000-4000-8000-000000000008', 'f3830000-0000-4000-8000-000000000003',
   'f3830000-0000-4000-8000-000000000002');
INSERT INTO public.customer_wallet_transactions (
  id, wallet_id, customer_id, merchant_id, type, amount, balance_after, status
) VALUES ('f3830000-0000-4000-8000-000000000009', 'f3830000-0000-4000-8000-000000000008',
  'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000002',
  'adjustment', 10, 10, 'completed');
-- 250 stale dispatched transfers (one goal each: a unique index allows one
-- pending transfer per intent and goal) and 1100 confirmed wallet credits.
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
)
SELECT ('f3830000-0000-4000-8000-' || lpad(to_hex(4096 + n), 12, '0'))::uuid,
  'f3830000-0000-4000-8000-000000000002', 'f3830000-0000-4000-8000-000000000003',
  'f3830000-0000-4000-8000-000000000004', 'Synthetic rotation goal ' || n, 10000, 0, 1000,
  'daily', current_date, current_date + 30, 'manual', now(), now()
FROM generate_series(1, 250) AS n;
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES ('f3830000-0000-4000-8000-00000000000a', 'f3830000-0000-4000-8000-000000000002',
   'f3830000-0000-4000-8000-000000000003', 'f3830000-0000-4000-8000-000000000004',
   'Synthetic rotation confirmed goal', 10000, 0, 1000, 'daily', current_date, current_date + 30,
   'manual', now(), now());
INSERT INTO piggyvest_primary.savings_operations (
  id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
  destination_wallet_id, reference, state, wallet_transaction_id, created_at, dispatched_at
)
SELECT ('f3830000-0000-4000-8000-' || lpad(to_hex(8192 + n), 12, '0'))::uuid,
  'f3830000-0000-4000-8000-000000000006', 'f3830000-0000-4000-8000-000000000007',
  ('f3830000-0000-4000-8000-' || lpad(to_hex(4096 + n), 12, '0'))::uuid, 100,
  'synthetic-main-wallet', 'synthetic-goal-x', 'rotation-stuck-' || n, 'dispatched',
  'f3830000-0000-4000-8000-000000000009', now() - interval '2 hours' - n * interval '1 second',
  now() - interval '1 minute'
FROM generate_series(1, 250) AS n;
INSERT INTO piggyvest_primary.savings_operations (
  id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
  destination_wallet_id, reference, state, wallet_transaction_id, created_at
)
SELECT ('f3830000-0000-4000-8000-' || lpad(to_hex(16384 + n), 12, '0'))::uuid,
  'f3830000-0000-4000-8000-000000000006', 'f3830000-0000-4000-8000-000000000007',
  'f3830000-0000-4000-8000-00000000000a', 100, 'synthetic-main-wallet',
  'rotation-wallet-' || lpad(n::text, 5, '0'), 'rotation-confirmed-' || n, 'confirmed',
  'f3830000-0000-4000-8000-000000000009', now() - interval '3 days'
FROM generate_series(1, 1100) AS n;

-- A cancel refund and a goal completion each empty one funded wallet, and an
-- unsettled (reserved) cancel must not count. The read must net the settled
-- ones off, so those two wallets expect 0 and the rest expect 100.
INSERT INTO piggyvest_primary.goal_cancel_operations (
  id, integration_id, intent_id, goal_id, state, reference, source_wallet_id,
  destination_wallet_id, amount_kobo, provider_transaction_id, issued_at, expires_at, settled_at
) VALUES ('f3830000-0000-4000-8000-00000000a001', 'f3830000-0000-4000-8000-000000000006',
  'f3830000-0000-4000-8000-000000000007', 'f3830000-0000-4000-8000-00000000b001', 'confirmed',
  'pvb-cancel-f3830000-0000-4000-8000-00000000b001', 'rotation-wallet-00001', 'synthetic-main-wallet',
  100, 'synthetic-cancel-tx-1', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', now() - interval '2 days');
INSERT INTO piggyvest_primary.goal_cancel_operations (
  id, integration_id, intent_id, goal_id, state, reference, source_wallet_id,
  destination_wallet_id, amount_kobo, issued_at, expires_at, reserved_at
) VALUES ('f3830000-0000-4000-8000-00000000a003', 'f3830000-0000-4000-8000-000000000006',
  'f3830000-0000-4000-8000-000000000007', 'f3830000-0000-4000-8000-00000000b003', 'reserved',
  'pvb-cancel-f3830000-0000-4000-8000-00000000b003', 'rotation-wallet-00003', 'synthetic-main-wallet',
  100, now() - interval '1 hour', now() + interval '1 hour', now() - interval '1 hour');
INSERT INTO piggyvest_primary.goal_complete_operations (
  id, integration_id, intent_id, goal_id, state, reference, source_wallet_id,
  destination_wallet_id, amount_kobo, provider_transaction_id, issued_at, expires_at, settled_at
) VALUES ('f3830000-0000-4000-8000-00000000a002', 'f3830000-0000-4000-8000-000000000006',
  'f3830000-0000-4000-8000-000000000007', 'f3830000-0000-4000-8000-00000000b002', 'confirmed',
  'pvb-complete-f3830000-0000-4000-8000-00000000b002', 'rotation-wallet-00002', 'synthetic-merchant-wallet',
  100, 'synthetic-complete-tx-1', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', now() - interval '2 days');

-- Catalog: the supporting indexes cover the reads' columns.
DO $indexes$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
      WHERE schemaname = 'piggyvest_primary' AND tablename = 'savings_operations'
        AND indexname = 'primary_savings_operation_recon_stuck_idx'
        AND indexdef LIKE '%USING btree (integration_id, state, created_at)') THEN
    RAISE EXCEPTION 'stuck-transfer read index is missing or has the wrong columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
      WHERE schemaname = 'piggyvest_primary' AND tablename = 'savings_operations'
        AND indexname = 'primary_savings_operation_recon_wallet_idx'
        AND indexdef LIKE '%USING btree (integration_id, destination_wallet_id) INCLUDE (amount_kobo) WHERE (state = ''confirmed''::text)') THEN
    RAISE EXCEPTION 'wallet read index is missing or has the wrong columns or predicate';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_indexes
      WHERE schemaname = 'piggyvest_primary' AND tablename = 'goal_cancel_operations'
        AND indexname = 'primary_goal_cancel_recon_wallet_idx'
        AND indexdef LIKE '%USING btree (integration_id, source_wallet_id) INCLUDE (amount_kobo) WHERE (state = ANY (ARRAY[''confirmed''::text, ''needs_review''::text, ''reviewed''::text]))') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'cancel wallet read index is missing or has the wrong columns or predicate';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_indexes
      WHERE schemaname = 'piggyvest_primary' AND tablename = 'goal_complete_operations'
        AND indexname = 'primary_goal_complete_recon_wallet_idx'
        AND indexdef LIKE '%USING btree (integration_id, source_wallet_id) INCLUDE (amount_kobo) WHERE (state = ANY (ARRAY[''confirmed''::text, ''needs_review''::text, ''reviewed''::text]))') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'complete wallet read index is missing or has the wrong columns or predicate';
  END IF;
END;
$indexes$;

-- Rotation: every slot reports the true totals and how many rows it deferred;
-- consecutive slots together return every stuck transfer and every wallet.
DO $rotation$
DECLARE
  integration uuid:='f3830000-0000-4000-8000-000000000006';
  snapshot jsonb;
  slot integer;
  expected jsonb;
  netted integer:=0;
  seen_wallets text[]:=ARRAY[]::text[];
  seen_stuck text[]:=ARRAY[]::text[];
BEGIN
  FOR slot IN 0..2 LOOP
    snapshot:=piggyvest_primary.read_daily_reconciliation(integration,'staging',
      jsonb_build_object('staleAfterSeconds',900,'rotationSlot',slot));
    IF (snapshot->>'walletsTotal')::int IS DISTINCT FROM 1100
      OR jsonb_array_length(snapshot->'wallets') IS DISTINCT FROM 500
      OR (snapshot->>'walletsDeferred')::int IS DISTINCT FROM 600
      OR (snapshot->>'stuckTotal')::int IS DISTINCT FROM 250
      OR jsonb_array_length(snapshot->'stuck') IS DISTINCT FROM 200
      OR (snapshot->>'stuckDeferred')::int IS DISTINCT FROM 50 THEN
      RAISE EXCEPTION 'Slot % reported wrong totals or deferrals: %', slot,
        (snapshot - 'wallets' - 'stuck');
    END IF;
    seen_wallets:=seen_wallets || ARRAY(SELECT item->>'walletId' FROM jsonb_array_elements(snapshot->'wallets') item);
    -- Netting: closed goals expect 0, an unsettled cancel changes nothing.
    FOR expected IN SELECT item FROM jsonb_array_elements(snapshot->'wallets') item LOOP
      IF (expected->>'expectedKobo')::bigint IS DISTINCT FROM
        (CASE WHEN expected->>'walletId' IN ('rotation-wallet-00001','rotation-wallet-00002') THEN 0 ELSE 100 END) THEN
        RAISE EXCEPTION 'Slot % wallet expected wrong amount: %', slot, expected;
      END IF;
      netted:=netted+1;
    END LOOP;
    IF slot <= 1 THEN
      seen_stuck:=seen_stuck || ARRAY(SELECT item->>'reference' FROM jsonb_array_elements(snapshot->'stuck') item);
    END IF;
  END LOOP;
  IF netted IS DISTINCT FROM 1500 THEN RAISE EXCEPTION 'Netting check saw % wallets', netted; END IF;
  IF (SELECT count(DISTINCT w) FROM unnest(seen_wallets) w) IS DISTINCT FROM 1100 THEN
    RAISE EXCEPTION 'Three slots did not cover all 1100 wallets';
  END IF;
  IF (SELECT count(DISTINCT s) FROM unnest(seen_stuck) s) IS DISTINCT FROM 250 THEN
    RAISE EXCEPTION 'Two slots did not cover all 250 stuck transfers';
  END IF;
  -- The same slot twice returns the same window (deterministic, no hidden state).
  IF piggyvest_primary.read_daily_reconciliation(integration,'staging',
      '{"staleAfterSeconds":900,"rotationSlot":1}')->'wallets'
    IS DISTINCT FROM piggyvest_primary.read_daily_reconciliation(integration,'staging',
      '{"staleAfterSeconds":900,"rotationSlot":1}')->'wallets' THEN
    RAISE EXCEPTION 'A repeated slot returned a different window';
  END IF;
  -- A slot past the end wraps to the same window as its remainder (1100 wallets).
  IF piggyvest_primary.read_daily_reconciliation(integration,'staging',
      '{"staleAfterSeconds":900,"rotationSlot":11}')->'wallets'
    IS DISTINCT FROM piggyvest_primary.read_daily_reconciliation(integration,'staging',
      '{"staleAfterSeconds":900,"rotationSlot":0}')->'wallets' THEN
    RAISE EXCEPTION 'Slot 11 (11 x 500 = 5 x 1100) did not wrap to slot 0';
  END IF;
END;
$rotation$;
ROLLBACK;
