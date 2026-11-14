-- Shared fixture for the paid-interest notification suites
-- (savings_interest_notification_triggers.sql and
-- savings_interest_notification_fallback.sql). Include it with \ir right
-- after the suite's BEGIN; every row it adds is rolled back with the suite.
--
-- One customer has a primary-wallet goal (30), a legacy ledger goal (31) and a
-- second-integration primary goal (32), each targeting ₦1,000 with ₦200 of
-- principal saved. Rows follow plan_transfer_interest_headroom.sql. Only the
-- paid interest crosswalk is inserted with replication triggers suspended: its
-- own provisioning chain is out of scope and only its row is needed for the
-- receipt foreign key. Every notifying insert in the suites runs with
-- triggers enabled.

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.id(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('a7c00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

-- Interest notices for one goal: (event_key, title, body, voided).
CREATE FUNCTION pg_temp.notices(p_goal uuid)
RETURNS TABLE(event_key text, title text, body text, voided boolean) LANGUAGE sql AS $$
  SELECT event.event_key, event.title, event.body, event.voided_at IS NOT NULL
  FROM savings_notifications.events event
  WHERE event.goal_id = p_goal AND event.type = 'interest_credited'
  ORDER BY event.event_key
$$;

CREATE FUNCTION pg_temp.payout_key(p_payout text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'primary-interest:' || pg_temp.id(40)::text || ':' || p_payout
$$;

CREATE FUNCTION pg_temp.receipt(p_payout text, p_net bigint) RETURNS void LANGUAGE sql AS $$
  INSERT INTO piggyvest_primary.paid_interest_receipts(integration_id, payout_id, crosswalk_id,
    goal_id, merchant_id, customer_id, net_kobo, financial_identity, body_digest)
  VALUES (pg_temp.id(40), p_payout, pg_temp.id(41), pg_temp.id(30), pg_temp.id(10),
    pg_temp.id(20), p_net, jsonb_build_object('payoutId', p_payout), repeat('a', 64))
$$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES (pg_temp.id(1));
INSERT INTO public.merchants(id, email) VALUES (pg_temp.id(10), 'interest-copy@example.com');
INSERT INTO public.products(id, merchant_id, name, price, status, stock_quantity)
  VALUES (pg_temp.id(11), pg_temp.id(10), 'Interest copy device', 1000, 'active', 3);
INSERT INTO public.customers(id, merchant_id, user_id) VALUES (pg_temp.id(20), pg_temp.id(10), pg_temp.id(1));
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, status,
  source_mode, target_amount, current_amount, contribution_amount, contribution_frequency,
  start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at)
SELECT pg_temp.id(n), pg_temp.id(10), pg_temp.id(20), pg_temp.id(11), 'Interest copy goal', 'active',
  'manual', 1000, 200, 100, 'daily', current_date, current_date + 30, now(), now()
FROM (VALUES (30), (31), (32), (33)) AS goal(n);

INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES (pg_temp.id(40), pg_temp.id(10), 'interest-copy-business', 'production',
    'interest_copy_fixture_executor', true),
  (pg_temp.id(42), pg_temp.id(10), 'interest-copy-business-b', 'production',
    'interest_copy_fixture_executor_b', true),
  (pg_temp.id(44), pg_temp.id(10), 'interest-copy-business-staging', 'staging',
    'interest_copy_fixture_executor_staging', true);
SET LOCAL session_replication_role = replica;
INSERT INTO piggyvest_primary.paid_interest_crosswalks(id, integration_id, goal_id, api_wallet_id,
  api_customer_id, onboarding_customer_id, webhook_customer_id, source_wallet_id, accrued_wallet_id,
  destination_wallet_id, envelope_destination_wallet_id, provider_evidence_sha256,
  policy_evidence_sha256, policy_reference, allocation_policy, enabled)
VALUES (pg_temp.id(41), pg_temp.id(40), pg_temp.id(30), 'copy-api-wallet', 'copy-api-customer',
  'copy-onboarding-customer', 'copy-webhook-customer', 'copy-source', 'copy-accrued',
  'copy-destination', NULL, repeat('a', 64), repeat('b', 64), 'synthetic-interest-copy-fixture',
  'provider_net_is_customer_plan_interest', true),
  (pg_temp.id(43), pg_temp.id(42), pg_temp.id(32), 'copy-api-wallet-b', 'copy-api-customer-b',
  'copy-onboarding-customer-b', 'copy-webhook-customer-b', 'copy-source-b', 'copy-accrued-b',
  'copy-destination-b', NULL, repeat('a', 64), repeat('b', 64), 'synthetic-interest-copy-fixture-b',
  'provider_net_is_customer_plan_interest', true),
  (pg_temp.id(45), pg_temp.id(44), pg_temp.id(33), 'copy-api-wallet-s', 'copy-api-customer-s',
  'copy-onboarding-customer-s', 'copy-webhook-customer-s', 'copy-source-s', 'copy-accrued-s',
  'copy-destination-s', NULL, repeat('a', 64), repeat('b', 64), 'synthetic-interest-copy-fixture-s',
  'provider_net_is_customer_plan_interest', true);
SET LOCAL session_replication_role = origin;

INSERT INTO piggyvest_staging.integrations(id, expected_provider_account_id, enabled)
  VALUES (pg_temp.id(50), 'provider-acct-interest-copy', true);
INSERT INTO piggyvest_savings_ledger.bindings(goal_id, integration_id, merchant_id, customer_id,
  authorized_login, enabled)
  VALUES (pg_temp.id(31), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), 'postgres', true);
