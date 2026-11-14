-- REGRESSION/CONTRACT TEST: public.list_piggyvest_wallet_activity as replaced
-- by 20261113150000_piggyvest_wallet_activity_wallet_pay lists what the
-- signed-in customer paid from the PiggyVest wallet (IMEI checks,
-- airtime/data/bills) and the refunds of those payments: customer words,
-- masked numbers, never a payment that moved no money, never another
-- customer's. Registered in replay-registry folder
-- 20261113150000_piggyvest_wallet_activity_wallet_pay.
\set ON_ERROR_STOP on
\ir piggyvest_wallet_pay.fixture.inc.sql

DO $behaviour$
DECLARE
  c_user constant text := 'f9a10000-0000-4000-8000-000000000001';
  c_customer constant uuid := 'f9a10000-0000-4000-8000-000000000003';
  c_merchant constant uuid := 'f9a10000-0000-4000-8000-000000000002';
  c_lookup constant text := 'f9a10000-0000-4000-8000-0000000000a9';
  c_airtime constant uuid := 'f9a10000-0000-4000-8000-0000000000b9';
  c_issued constant text := 'f9a10000-0000-4000-8000-0000000000c9';
  c_neighbour_user constant uuid := 'f9a10000-0000-4000-8000-0000000000f1';
  c_neighbour constant uuid := 'f9a10000-0000-4000-8000-0000000000f3';
  c_goal constant uuid := 'f9a10000-0000-4000-8000-0000000000f5';
  c_cancel constant uuid := 'f9a10000-0000-4000-8000-0000000000f7';
  c_dispatched constant timestamptz := now() - interval '2 hours';
  v_imei text;
  v_vtu text;
  v_rows jsonb;
  v_fee text;
  v_deferred text;
BEGIN
  PERFORM pg_temp.wp_collection();
  -- An IMEI check paid and confirmed, then refunded (refund sent).
  v_imei := pg_temp.wp_dispatched(c_lookup, 100000);
  PERFORM pg_temp.wp_settle(pg_temp.wp_pay_proof(v_imei, 'txn-activity-imei'));
  INSERT INTO piggyvest_primary.wallet_payment_refunds (
    payment_id, integration_id, attempt, state, reference, amount_kobo,
    source_wallet_id, destination_wallet_id, created_at, dispatched_at)
  VALUES (v_imei::uuid, 'f9a10000-0000-4000-8000-000000000006', 0, 'dispatched',
    'pvb-refund-' || v_imei, 100000, 'synthetic-walletpay-collection',
    'synthetic-walletpay-main', pg_catalog.clock_timestamp() - interval '1 hour',
    pg_catalog.clock_timestamp());
  -- REGRESSION (Codex P2): an earlier attempt released but later proven
  -- successful credited the customer too: it is listed, completed.
  INSERT INTO piggyvest_primary.wallet_payment_refunds (
    payment_id, integration_id, attempt, state, reference, amount_kobo,
    source_wallet_id, destination_wallet_id, dispatched_at, settled_at,
    provider_transaction_id, review_reason)
  VALUES (v_imei::uuid, 'f9a10000-0000-4000-8000-000000000006', 1, 'released',
    'pvb-refund-' || v_imei || '-1', 100000, 'synthetic-walletpay-collection',
    'synthetic-walletpay-main', pg_catalog.clock_timestamp() - interval '2 hours',
    pg_catalog.clock_timestamp(), 'txn-activity-late', 'late_refund_success');
  -- Airtime paid from the wallet: PIN reserved, not yet confirmed.
  INSERT INTO public.vtu_transactions (id, customer_id, merchant_id, type, network_provider,
    phone_number, request_reference, source, metadata, amount, status)
  VALUES (c_airtime, c_customer, c_merchant, 'airtime', 'mtn', '08031234567',
    'vtu-activity-1', 'checkout', '{"paymentSource":"piggyvest_wallet"}', 500, 'pending');
  v_vtu := pg_temp.wp_issue(c_airtime::text, 50000, 'vtu') ->> 'operationId';
  PERFORM pg_temp.wp_assert(pg_temp.wp_reserve(v_vtu, pg_temp.wp_proof('activity-vtu', 'wallet_pay',
    50000, pg_temp.wp_key(v_vtu, c_airtime::text, 'vtu'))) ->> 'status' = 'claimed', 'vtu reserve');
  -- Issued only (no PIN): moved no money, never listed.
  PERFORM pg_temp.wp_issue(c_issued, 70000);

  -- REGRESSION (Muse): a meter number of four characters or fewer is
  -- never shown, not even its last four.
  INSERT INTO public.vtu_transactions (id, customer_id, merchant_id, type, network_provider,
    phone_number, request_reference, source, metadata, amount, status, biller_name, customer_identifier)
  VALUES ('f9a10000-0000-4000-8000-0000000000e9', c_customer, c_merchant, 'betting', '',
    '', 'vtu-activity-short', 'checkout', '{"paymentSource":"piggyvest_wallet"}', 300, 'pending',
    'Short Bet', '1234');
  v_vtu := pg_temp.wp_issue('f9a10000-0000-4000-8000-0000000000e9', 30000, 'vtu') ->> 'operationId';
  PERFORM pg_temp.wp_assert(pg_temp.wp_reserve(v_vtu, pg_temp.wp_proof('activity-short', 'wallet_pay',
    30000, pg_temp.wp_key(v_vtu, 'f9a10000-0000-4000-8000-0000000000e9', 'vtu'))) ->> 'status' = 'claimed',
    'short reserve');
  -- REGRESSION (Codex P2 + Muse): a goal return settled after dispatch keeps
  -- its dispatch date, and names only the caller's own goal (this one is a
  -- neighbour's).
  INSERT INTO auth.users (id, email) VALUES (c_neighbour_user, 'walletpay-neighbour@example.test');
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (c_neighbour, c_merchant, c_neighbour_user, 'walletpay-neighbour@example.test');
  INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity)
  VALUES ('f9a10000-0000-4000-8000-0000000000a4', c_merchant, 'Synthetic goal product', 10000, 'active', 1);
  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
    terms_accepted_at, non_withdrawable_accepted_at)
  VALUES (c_goal, c_merchant, c_neighbour, 'f9a10000-0000-4000-8000-0000000000a4', 'Neighbour secret',
    10000, 0, 1000, 'daily', current_date, current_date + 30, 'manual', now(), now());
  INSERT INTO piggyvest_primary.goal_cancel_operations (
    id, integration_id, intent_id, goal_id, state, reference, source_wallet_id,
    destination_wallet_id, amount_kobo, provider_transaction_id, issued_at, expires_at,
    reserved_at, dispatched_at, settled_at)
  VALUES (c_cancel, 'f9a10000-0000-4000-8000-000000000006', 'f9a10000-0000-4000-8000-000000000007',
    c_goal, 'confirmed', 'pvb-cancel-' || c_goal::text, 'synthetic-walletpay-goal',
    'synthetic-walletpay-main', 40000, 'synthetic-cancel-tx', c_dispatched - interval '5 minutes',
    c_dispatched + interval '1 hour', c_dispatched - interval '5 minutes', c_dispatched, now());

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', c_user, true);
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row) ORDER BY row.kind, row.amount_kobo)
    INTO v_rows
    FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
   WHERE row.kind IN ('wallet_spend', 'wallet_refund');

  PERFORM pg_temp.wp_assert(EXISTS (
      SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
       WHERE row.kind = 'wallet_spend' AND row.label = 'Short Bet · …'),
    'a short meter number was shown');
  PERFORM pg_temp.wp_assert(EXISTS (
      SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
       WHERE row.id = c_cancel AND row.occurred_at = c_dispatched
         AND row.label = 'Returned from a savings goal'),
    'the goal return moved to its settle date or named another customer''s goal');
  PERFORM pg_temp.wp_assert((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_rows) AS item
      WHERE item ->> 'kind' = 'wallet_refund' AND item ->> 'status' = 'completed') = 1,
    'the late refund success is not listed as completed: ' || v_rows::text);
  v_rows := (SELECT pg_catalog.jsonb_agg(item) FROM pg_catalog.jsonb_array_elements(v_rows) AS item
              WHERE item ->> 'label' <> 'Short Bet · …'
                AND NOT (item ->> 'kind' = 'wallet_refund' AND item ->> 'status' = 'completed'));
  PERFORM pg_temp.wp_assert(pg_catalog.jsonb_array_length(v_rows) = 3,
    'expected two spends and one refund: ' || COALESCE(v_rows::text, 'none'));
  -- REGRESSION (Muse): a refund is dated when it was sent, not opened.
  PERFORM pg_temp.wp_assert((SELECT row.occurred_at = refund.dispatched_at
      FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      JOIN piggyvest_primary.wallet_payment_refunds AS refund ON refund.id = row.id
     WHERE row.kind = 'wallet_refund' AND refund.attempt = 0), 'the refund is not dated when it was sent');
  PERFORM pg_temp.wp_assert(v_rows -> 0 ->> 'kind' = 'wallet_refund'
      AND v_rows -> 0 ->> 'direction' = 'in'
      AND v_rows -> 0 ->> 'label' = 'Refund: IMEI check'
      AND v_rows -> 0 ->> 'status' = 'pending'
      AND (v_rows -> 0 ->> 'amount_kobo')::bigint = 100000,
    'the refund row is wrong: ' || (v_rows -> 0)::text);
  PERFORM pg_temp.wp_assert(v_rows -> 1 ->> 'kind' = 'wallet_spend'
      AND v_rows -> 1 ->> 'direction' = 'out'
      AND v_rows -> 1 ->> 'label' = 'Airtime · MTN · 0803…4567'
      AND v_rows -> 1 ->> 'status' = 'pending'
      AND (v_rows -> 1 ->> 'amount_kobo')::bigint = 50000,
    'the airtime row is wrong: ' || (v_rows -> 1)::text);
  PERFORM pg_temp.wp_assert(v_rows -> 2 ->> 'label' = 'IMEI check'
      AND v_rows -> 2 ->> 'status' = 'completed',
    'the IMEI row is wrong: ' || (v_rows -> 2)::text);
  -- The full phone number and any purchase id never appear.
  PERFORM pg_temp.wp_assert(v_rows::text NOT LIKE '%08031234567%'
      AND v_rows::text NOT LIKE '%' || c_airtime::text || '%'
      AND v_rows::text NOT LIKE '%' || c_lookup || '%',
    'a full number or purchase id leaked');

  -- REGRESSION (Muse): a long biller name never exceeds the row schema.
  INSERT INTO public.vtu_transactions (id, customer_id, merchant_id, type, network_provider,
    phone_number, request_reference, source, metadata, amount, status, biller_name, customer_identifier)
  VALUES ('f9a10000-0000-4000-8000-0000000000d9', c_customer, c_merchant, 'electricity', '',
    '08031234567', 'vtu-activity-2', 'checkout', '{"paymentSource":"piggyvest_wallet"}', 700, 'pending',
    pg_catalog.repeat('Long Biller ', 80), '45031234567');
  v_vtu := pg_temp.wp_issue('f9a10000-0000-4000-8000-0000000000d9', 70000, 'vtu') ->> 'operationId';
  PERFORM pg_temp.wp_assert(pg_temp.wp_reserve(v_vtu, pg_temp.wp_proof('activity-long', 'wallet_pay',
    70000, pg_temp.wp_key(v_vtu, 'f9a10000-0000-4000-8000-0000000000d9', 'vtu'))) ->> 'status' = 'claimed',
    'long reserve');
  PERFORM pg_temp.wp_assert((SELECT pg_catalog.max(pg_catalog.char_length(row.label))
    FROM public.list_piggyvest_wallet_activity(c_merchant) AS row) <= 120, 'a label exceeded 120 characters');
  -- REGRESSION (Muse): the masked suffix survives a long name, refund too.
  INSERT INTO piggyvest_primary.wallet_payment_refunds (
    payment_id, integration_id, attempt, state, reference, amount_kobo,
    source_wallet_id, destination_wallet_id, dispatched_at)
  VALUES (v_vtu::uuid, 'f9a10000-0000-4000-8000-000000000006', 0, 'dispatched',
    'pvb-refund-' || v_vtu, 70000, 'synthetic-walletpay-collection',
    'synthetic-walletpay-main', pg_catalog.clock_timestamp());
  PERFORM pg_temp.wp_assert((SELECT pg_catalog.count(*) FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.label LIKE 'Long Biller%' OR row.label LIKE 'Refund: Long Biller%') = 2
    AND NOT EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE (row.label LIKE 'Long Biller%' OR row.label LIKE 'Refund: Long Biller%')
        AND row.label NOT LIKE '%· 4503…4567'), 'a long biller name cut the masked number');
  DELETE FROM piggyvest_primary.wallet_payment_refunds WHERE payment_id = v_vtu::uuid;
  -- REGRESSION (Muse): a refund not yet sent is not listed, so its date can
  -- not jump between pages once it is; once sent it is dated by that moment.
  INSERT INTO piggyvest_primary.wallet_payment_refunds (
    payment_id, integration_id, attempt, state, review_reason, reference, amount_kobo,
    source_wallet_id, destination_wallet_id, created_at)
  VALUES (v_vtu::uuid, 'f9a10000-0000-4000-8000-000000000006', 0, 'needs_review', 'unsure',
    'pvb-refund-' || v_vtu, 70000, 'synthetic-walletpay-collection',
    'synthetic-walletpay-main', pg_catalog.clock_timestamp() - interval '3 days');
  PERFORM pg_temp.wp_assert(NOT EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.label LIKE 'Refund: Long Biller%'), 'an unsent refund was listed');
  UPDATE piggyvest_primary.wallet_payment_refunds
     SET dispatched_at = pg_catalog.clock_timestamp() WHERE payment_id = v_vtu::uuid;
  PERFORM pg_temp.wp_assert((SELECT pg_catalog.count(*) = 1 AND pg_catalog.bool_and(row.occurred_at > pg_catalog.clock_timestamp() - interval '1 day')
      FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.label LIKE 'Refund: Long Biller%'), 'a sent refund was not dated by its sending');
  DELETE FROM piggyvest_primary.wallet_payment_refunds WHERE payment_id = v_vtu::uuid;
  -- REGRESSION (Muse): a long network name never cuts the masked number.
  UPDATE public.vtu_transactions SET network_provider = pg_catalog.repeat('n', 200)
   WHERE id = c_airtime;
  PERFORM pg_temp.wp_assert(EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.label LIKE 'Airtime · NNN%' AND row.label LIKE '%· 0803…4567'),
    'a long network name cut the masked number');
  UPDATE public.vtu_transactions SET network_provider = 'mtn' WHERE id = c_airtime;

  -- REGRESSION (Codex P2): a failed transfer that only charged a fee is not a
  -- purchase; a released attempt proven successful while another attempt was
  -- unresolved did move money and shows as a pending spend.
  v_fee := pg_temp.wp_dispatched('f9a10000-0000-4000-8000-0000000000aa', 100000);
  UPDATE piggyvest_primary.wallet_payments
     SET state = 'needs_review', review_reason = 'failed_with_fee',
         provider_transaction_id = 'txn-activity-fee', settled_at = pg_catalog.clock_timestamp()
   WHERE id = v_fee::uuid;
  v_deferred := pg_temp.wp_dispatched('f9a10000-0000-4000-8000-0000000000ab', 100000);
  -- REGRESSION (Muse): a released row with that reason but no provider proof
  -- moved no money, so it is not listed; with the proof it is.
  UPDATE piggyvest_primary.wallet_payments
     SET state = 'released', review_reason = 'late_success_deferred'
   WHERE id = v_deferred::uuid;
  PERFORM pg_temp.wp_assert(NOT EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.id = v_deferred::uuid), 'a released spend without provider proof was listed');
  UPDATE piggyvest_primary.wallet_payments
     SET provider_transaction_id = 'txn-activity-deferred'
   WHERE id = v_deferred::uuid;
  PERFORM pg_temp.wp_assert(NOT EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.id = v_fee::uuid), 'a fee-only failure was listed as a purchase');
  PERFORM pg_temp.wp_assert(EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.id = v_deferred::uuid AND row.kind = 'wallet_spend' AND row.status = 'pending'),
    'a deferred late success was hidden');
  -- REGRESSION (Codex P2): a refund that failed and only charged a fee
  -- credited nothing, so it is not listed as money coming in.
  UPDATE piggyvest_primary.wallet_payment_refunds
     SET state = 'needs_review', review_reason = 'failed_with_fee',
         provider_transaction_id = 'txn-activity-refund-fee', settled_at = pg_catalog.clock_timestamp()
   WHERE payment_id = v_imei::uuid AND attempt = 0;
  PERFORM pg_temp.wp_assert(NOT EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      JOIN piggyvest_primary.wallet_payment_refunds AS refund ON refund.id = row.id
     WHERE refund.payment_id = v_imei::uuid AND refund.attempt = 0),
    'a fee-only refund failure was listed as money in');

  -- REGRESSION (Muse): a corrupt amount drops its own row, never the page.
  EXECUTE (SELECT pg_catalog.string_agg(pg_catalog.format(
      'ALTER TABLE piggyvest_primary.wallet_payments DROP CONSTRAINT %I', con.conname), '; ')
     FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'piggyvest_primary.wallet_payments'::regclass AND con.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%amount_kobo%');
  UPDATE piggyvest_primary.wallet_payments SET amount_kobo = 0 WHERE id = v_deferred::uuid;
  PERFORM pg_temp.wp_assert(NOT EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.amount_kobo <= 0), 'a row with no positive amount was listed');
  PERFORM pg_temp.wp_assert(EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant)),
    'one corrupt amount emptied the page');

  -- REGRESSION (Muse): a purchase row with no type or biller never yields
  -- an empty label (which would fail the page): it reads as a purchase.
  ALTER TABLE public.vtu_transactions ALTER COLUMN type DROP NOT NULL;
  UPDATE public.vtu_transactions SET type = NULL, biller_name = '' WHERE id = c_airtime;
  PERFORM pg_temp.wp_assert(EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.kind = 'wallet_spend' AND row.label = 'Airtime, data or bill'),
    'a purchase with no type lost its label');
  PERFORM pg_temp.wp_assert(NOT EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE NULLIF(row.label, '') IS NULL), 'an empty label was listed');

  -- REGRESSION (Muse): a second verified customer of the same store sees
  -- none of this customer's spends or refunds.
  PERFORM pg_temp.wp_assert(EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.kind IN ('wallet_spend', 'wallet_refund')), 'the caller has no spends to leak');
  INSERT INTO piggyvest_primary.onboarding_intents (
    id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
    provider_customer_id, provider_wallet_id)
  VALUES ('f9a10000-0000-4000-8000-0000000000a7', 'f9a10000-0000-4000-8000-000000000006',
    c_merchant, c_neighbour, c_neighbour_user, pg_catalog.repeat('d', 64), 'accepted',
    'synthetic-walletpay-neighbour', 'synthetic-walletpay-neighbour-main');
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', c_neighbour_user::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
    'sub', c_neighbour_user, 'role', 'authenticated')::text, true);
  PERFORM pg_temp.wp_assert(NOT EXISTS (SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
      WHERE row.kind IN ('wallet_spend', 'wallet_refund')),
    'a neighbour in the same store saw another customer''s spends or refunds');

  -- Another user sees none of it.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', 'f9a10000-0000-4000-8000-0000000000ff', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
    'sub', 'f9a10000-0000-4000-8000-0000000000ff', 'role', 'authenticated')::text, true);
  PERFORM pg_temp.wp_assert(NOT EXISTS (
    SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant)), 'another user saw the activity');

  -- Grants unchanged: only authenticated.
  PERFORM pg_temp.wp_assert(pg_catalog.has_function_privilege('authenticated',
    'public.list_piggyvest_wallet_activity(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
    'authenticated can not read activity');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('anon',
    'public.list_piggyvest_wallet_activity(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
    'anon can read activity');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('service_role',
    'public.list_piggyvest_wallet_activity(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
    'service_role can read activity');
END;
$behaviour$;

ROLLBACK;
