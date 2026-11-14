-- REGRESSION/CONTRACT TEST: public.list_piggyvest_wallet_activity (migration
-- 20261113140000_piggyvest_wallet_activity_read) returns ONLY the signed-in
-- customer's own PiggyVest main-wallet movements for the store asked, newest
-- first, with customer-facing fields only, and only `authenticated` may call
-- it. Synthetic, transaction-local fixture; everything rolls back.
BEGIN;
SET LOCAL search_path = pg_catalog, public, extensions;

-- Two customers of one store (A owns the activity, B is a neighbour with
-- their own deposit), one PiggyVest integration.
INSERT INTO auth.users (id, email) VALUES
  ('f3870000-0000-4000-8000-000000000001', 'piggyvest-activity-a@example.test'),
  ('f3870000-0000-4000-8000-000000000011', 'piggyvest-activity-b@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3870000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000001',
   'piggyvest-activity@example.test', 'PiggyVest Activity Fixture', 'piggyvest-activity-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3870000-0000-4000-8000-000000000003', 'f3870000-0000-4000-8000-000000000002',
   'f3870000-0000-4000-8000-000000000001', 'piggyvest-activity-a@example.test'),
  ('f3870000-0000-4000-8000-000000000013', 'f3870000-0000-4000-8000-000000000002',
   'f3870000-0000-4000-8000-000000000011', 'piggyvest-activity-b@example.test');
INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity) VALUES
  ('f3870000-0000-4000-8000-000000000004', 'f3870000-0000-4000-8000-000000000002',
   'Synthetic activity product', 10000, 'active', 1);
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
  terms_accepted_at, non_withdrawable_accepted_at
)
SELECT g.id::uuid, 'f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000003',
  'f3870000-0000-4000-8000-000000000004', g.title, 10000, 0, 1000, 'daily',
  current_date, current_date + 30, 'manual', now(), now()
FROM (VALUES
  ('f3870000-0000-4000-8000-000000000005', 'iPhone fund'),
  ('f3870000-0000-4000-8000-000000000015', 'Laptop fund'),
  ('f3870000-0000-4000-8000-000000000025', 'Tablet fund')) AS g(id, title);
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3870000-0000-4000-8000-000000000006', 'f3870000-0000-4000-8000-000000000002',
  'synthetic-activity-business', 'staging', 'retired-activity-executor', true);
INSERT INTO piggyvest_primary.onboarding_intents (
  id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
  provider_customer_id, provider_wallet_id
) VALUES
  ('f3870000-0000-4000-8000-000000000007', 'f3870000-0000-4000-8000-000000000006',
   'f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000003',
   'f3870000-0000-4000-8000-000000000001', repeat('c', 64), 'accepted',
   'synthetic-activity-customer-a', 'synthetic-activity-wallet-a'),
  ('f3870000-0000-4000-8000-000000000017', 'f3870000-0000-4000-8000-000000000006',
   'f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000013',
   'f3870000-0000-4000-8000-000000000011', repeat('d', 64), 'accepted',
   'synthetic-activity-customer-b', 'synthetic-activity-wallet-b');

-- A: a bank transfer (5 days ago), B: a deposit A must never see.
INSERT INTO piggyvest_primary.inflow_receipts (
  id, integration_id, intent_id, provider_transaction_id, event_id, body_digest,
  financial_identity, created_at
) VALUES
  ('f3870000-0000-4000-8000-0000000000a1', 'f3870000-0000-4000-8000-000000000006',
   'f3870000-0000-4000-8000-000000000007', 'secret-provider-tx-a', 'evt-activity-a', repeat('e', 64),
   '{"amountKobo":5000000,"feeKobo":0,"currency":"NGN","reference":"secret-ref-a"}'::jsonb,
   now() - interval '5 days'),
  ('f3870000-0000-4000-8000-0000000000b1', 'f3870000-0000-4000-8000-000000000006',
   'f3870000-0000-4000-8000-000000000017', 'secret-provider-tx-b', 'evt-activity-b', repeat('f', 64),
   '{"amountKobo":999900,"feeKobo":5000,"currency":"NGN","reference":"secret-ref-b"}'::jsonb,
   now() - interval '1 day');
-- A: a confirmed contribution (4 days), a pending one (3 days), a cancelled
-- reservation that never moved money (2 days, must not appear).
INSERT INTO piggyvest_primary.savings_operations (
  id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
  destination_wallet_id, reference, state, created_at
) VALUES
  ('f3870000-0000-4000-8000-0000000000a2', 'f3870000-0000-4000-8000-000000000006',
   'f3870000-0000-4000-8000-000000000007', 'f3870000-0000-4000-8000-000000000005', 1000000,
   'synthetic-activity-wallet-a', 'synthetic-goal-1', 'pvb-save-activity-1', 'confirmed', now() - interval '4 days'),
  ('f3870000-0000-4000-8000-0000000000a3', 'f3870000-0000-4000-8000-000000000006',
   'f3870000-0000-4000-8000-000000000007', 'f3870000-0000-4000-8000-000000000015', 200000,
   'synthetic-activity-wallet-a', 'synthetic-goal-2', 'pvb-save-activity-2', 'dispatched', now() - interval '3 days'),
  ('f3870000-0000-4000-8000-0000000000a4', 'f3870000-0000-4000-8000-000000000006',
   'f3870000-0000-4000-8000-000000000007', 'f3870000-0000-4000-8000-000000000025', 300000,
   'synthetic-activity-wallet-a', 'synthetic-goal-3', 'pvb-save-activity-3', 'cancelled', now() - interval '2 days');
-- A: the Laptop goal cancelled early and refunded (1 day ago).
INSERT INTO piggyvest_primary.goal_cancel_operations (
  id, integration_id, intent_id, goal_id, state, reference, source_wallet_id,
  destination_wallet_id, amount_kobo, provider_transaction_id, issued_at, expires_at,
  reserved_at, dispatched_at, settled_at
) VALUES ('f3870000-0000-4000-8000-0000000000a5', 'f3870000-0000-4000-8000-000000000006',
  'f3870000-0000-4000-8000-000000000007', 'f3870000-0000-4000-8000-000000000015', 'confirmed',
  'pvb-cancel-f3870000-0000-4000-8000-000000000015', 'synthetic-goal-2',
  'synthetic-activity-wallet-a', 200000, 'secret-cancel-tx',
  now() - interval '1 day 1 hour', now() + interval '1 hour', now() - interval '1 day 1 hour',
  now() - interval '1 day 30 minutes', now() - interval '1 day');

DO $catalog$
DECLARE
  v_oid oid := to_regprocedure(
    'public.list_piggyvest_wallet_activity(uuid,timestamptz,uuid,integer)');
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'activity read missing'; END IF;
  IF NOT (SELECT p.prosecdef AND p.provolatile = 's'
            AND p.proconfig @> ARRAY['search_path=""']
            FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid) THEN
    RAISE EXCEPTION 'activity read must be a STABLE SECURITY DEFINER with an empty search_path';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
    OR has_function_privilege('anon', v_oid, 'EXECUTE')
    OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'only authenticated may call the activity read';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p, aclexplode(p.proacl) AS acl
              WHERE p.oid = v_oid AND acl.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC must have no EXECUTE on the activity read';
  END IF;
  -- Only customer-facing columns leave the function.
  IF (SELECT array_agg(name ORDER BY ord) FROM unnest(
        (SELECT p.proargnames FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid),
        (SELECT p.proargmodes FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid)::text[])
        WITH ORDINALITY AS a(name, mode, ord) WHERE mode = 't')
     IS DISTINCT FROM ARRAY['id','kind','direction','amount_kobo','fee_kobo','label','status','occurred_at'] THEN
    RAISE EXCEPTION 'activity read returns unexpected columns';
  END IF;
END
$catalog$;

-- Customer A, as the authenticated role.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3870000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $own_rows$
DECLARE
  v_rows jsonb;
  v_page jsonb;
  v_last record;
BEGIN
  SELECT jsonb_agg(to_jsonb(activity) - 'id' - 'occurred_at')
    INTO v_rows
    FROM public.list_piggyvest_wallet_activity(
      'f3870000-0000-4000-8000-000000000002') AS activity;
  IF v_rows IS DISTINCT FROM '[
    {"kind":"goal_refund","direction":"in","amount_kobo":200000,"fee_kobo":0,"label":"Returned from Laptop fund","status":"completed"},
    {"kind":"savings_contribution","direction":"out","amount_kobo":200000,"fee_kobo":0,"label":"Saved to Laptop fund","status":"pending"},
    {"kind":"savings_contribution","direction":"out","amount_kobo":1000000,"fee_kobo":0,"label":"Saved to iPhone fund","status":"completed"},
    {"kind":"bank_transfer","direction":"in","amount_kobo":5000000,"fee_kobo":0,"label":"Money added","status":"completed"}
  ]'::jsonb THEN
    RAISE EXCEPTION 'wrong activity for customer A: %', v_rows;
  END IF;
  -- Nothing internal leaks: no provider ids, references or the neighbour's row.
  IF v_rows::text ~ '(secret|pvb-|synthetic-)' THEN
    RAISE EXCEPTION 'activity leaked internal identifiers: %', v_rows;
  END IF;

  -- Keyset pages: two, then the remaining two, never repeating a row.
  SELECT activity.occurred_at, activity.id INTO v_last
    FROM public.list_piggyvest_wallet_activity(
      'f3870000-0000-4000-8000-000000000002', NULL, NULL, 2) AS activity
   ORDER BY activity.occurred_at ASC LIMIT 1;
  SELECT jsonb_agg(activity.kind ORDER BY activity.occurred_at DESC)
    INTO v_page
    FROM public.list_piggyvest_wallet_activity(
      'f3870000-0000-4000-8000-000000000002', v_last.occurred_at, v_last.id, 2) AS activity;
  IF v_page IS DISTINCT FROM '["savings_contribution","bank_transfer"]'::jsonb THEN
    RAISE EXCEPTION 'wrong second page: %', v_page;
  END IF;

  -- Another store: nothing, even though A has a PiggyVest wallet elsewhere.
  IF EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(
               'f3870000-0000-4000-8000-0000000000ff')) THEN
    RAISE EXCEPTION 'activity returned rows for another store';
  END IF;

  -- Malformed requests are refused, not answered.
  BEGIN
    PERFORM public.list_piggyvest_wallet_activity(
      'f3870000-0000-4000-8000-000000000002', NULL, NULL, 51);
    RAISE EXCEPTION 'a limit above 50 was accepted' USING ERRCODE = 'PVT01';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.list_piggyvest_wallet_activity(
      'f3870000-0000-4000-8000-000000000002', now(), NULL, 20);
    RAISE EXCEPTION 'a half cursor was accepted' USING ERRCODE = 'PVT01';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END
$own_rows$;

-- Customer B sees only B's deposit, credited net of its ₦50 fee
-- (999900 - 5000 kobo), with the fee reported on its own (Fable walk F3).
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3870000-0000-4000-8000-000000000011', 'role', 'authenticated')::text, true);
DO $neighbour$
DECLARE v_rows jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(activity) - 'id' - 'occurred_at') INTO v_rows
    FROM public.list_piggyvest_wallet_activity(
      'f3870000-0000-4000-8000-000000000002') AS activity;
  IF v_rows IS DISTINCT FROM '[{"kind":"bank_transfer","direction":"in","amount_kobo":994900,"fee_kobo":5000,"label":"Money added","status":"completed"}]'::jsonb THEN
    RAISE EXCEPTION 'customer B saw the wrong activity: %', v_rows;
  END IF;
END
$neighbour$;

-- No signed-in user: refused.
SELECT set_config('request.jwt.claims', '{}', true);
DO $signed_out$
BEGIN
  PERFORM public.list_piggyvest_wallet_activity('f3870000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'a signed-out call was answered' USING ERRCODE = 'PVT01';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$signed_out$;

RESET ROLE;

-- Review holds and settling (Codex): a held cancel already credited the
-- wallet, so it reads completed; settling later never moves its ordering
-- key (keyset pages stay stable); a malformed provider timestamp is ignored.
UPDATE piggyvest_primary.goal_cancel_operations
   SET state = 'needs_review', settled_at = now()
 WHERE id = 'f3870000-0000-4000-8000-0000000000a5';
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3870000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $review$
DECLARE v_row record;
BEGIN
  SELECT activity.status, activity.occurred_at INTO v_row
    FROM public.list_piggyvest_wallet_activity('f3870000-0000-4000-8000-000000000002') AS activity
   WHERE activity.id = 'f3870000-0000-4000-8000-0000000000a5';
  IF v_row.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'a review-held refund must read completed, got %', v_row.status;
  END IF;
  IF v_row.occurred_at > now() - interval '1 day 29 minutes' THEN
    RAISE EXCEPTION 'settling moved the ordering key to %', v_row.occurred_at;
  END IF;
END
$review$;
RESET ROLE;
DO $parse$
BEGIN
  IF piggyvest_primary.parse_receipt_credited_at('2026-02-31T10:00:00Z') IS NOT NULL
    OR piggyvest_primary.parse_receipt_credited_at(NULL) IS NOT NULL
    OR piggyvest_primary.parse_receipt_credited_at('2026-11-12T10:00:00Z')
       IS DISTINCT FROM '2026-11-12T10:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'credited-at parsing is wrong';
  END IF;
END
$parse$;
ROLLBACK;
