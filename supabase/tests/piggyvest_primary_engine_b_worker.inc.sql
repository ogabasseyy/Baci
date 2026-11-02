-- Part of piggyvest_primary_engine_schema.sql (\ir): the worker pass.
-- A worker login applies only its own integration's requests, only while
-- its authority and the integration are enabled; a transient failure leaves
-- a request for a later pass instead of parking it in review. Runs after the
-- B-cap part, which leaves no request open.

-- A second integration (merchant 12, customer 13) with one requested credit.
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES (pg_temp.id(80), pg_temp.id(12), 'engine-other-business', 'staging', 'engine_other_executor', true);
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES (pg_temp.id(81), pg_temp.id(80), pg_temp.id(12), pg_temp.id(13), pg_temp.id(1),
    repeat('9', 64), 'verified', 'pv-other-customer-13', 'pv-other-main-13');
INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency, enabled,
  verified_at)
  VALUES (pg_temp.id(80), 'collection', 'pv-other-collection', 'engine-other-business', 'NGN', true,
    TIMESTAMPTZ '2026-10-31 00:00:00+00');
INSERT INTO public.customer_wallets(customer_id, merchant_id, available_balance)
  VALUES (pg_temp.id(13), pg_temp.id(12), 0.00);
SELECT pg_temp.wt('disbursement', 'obligation', 'credit_main', 'w-other', 'ready', 3000,
  jsonb_build_object('integration', pg_temp.id(80), 'customer', pg_temp.id(13))) AS other_transfer \gset
SELECT pg_temp.confirm(:'other_transfer');
SELECT pg_temp.wt('disbursement', 'obligation', 'credit_main', 'w-own', 'ready', 2000,
  jsonb_build_object('customer', pg_temp.id(70))) AS own_transfer \gset
SELECT pg_temp.confirm(:'own_transfer');
SELECT pg_temp.check(piggyvest_primary.request_b_effect(:'other_transfer', 'confirm_credit', 3000) = 'requested'
  AND piggyvest_primary.request_b_effect(:'own_transfer', 'confirm_credit', 2000) = 'requested',
  'both credits are requested');
INSERT INTO piggyvest_primary.transfer_authorities(integration_id, capability, executor_login, enabled) VALUES
  (pg_temp.id(5), 'worker', session_user, true),
  (pg_temp.id(80), 'worker', 'engine_other_worker', true);

-- A disabled authority, or a switched-off integration, applies nothing.
SAVEPOINT engine_worker_switches;
UPDATE piggyvest_primary.transfer_authorities SET enabled = false WHERE executor_login = session_user;
SELECT pg_temp.check(pg_temp.sqlstate_of('SELECT pg_temp.work()') = '42501',
  'a disabled worker authority must not apply');
ROLLBACK TO SAVEPOINT engine_worker_switches;
SAVEPOINT engine_worker_switches;
UPDATE piggyvest_primary.integrations SET enabled = false WHERE id = pg_temp.id(5);
SELECT pg_temp.check(pg_temp.sqlstate_of('SELECT pg_temp.work()') = '42501',
  'a switched-off integration must not apply');
ROLLBACK TO SAVEPOINT engine_worker_switches;

-- A transient failure (here out of memory, raised by a wallet trigger for
-- this customer only) leaves the request for the next pass.
CREATE FUNCTION pg_temp.transient_wallet_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id = 'e5e00000-0000-4000-8000-000000000070'::uuid THEN
    RAISE EXCEPTION 'simulated transient failure' USING ERRCODE = '53200';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER engine_suite_transient_failure BEFORE UPDATE ON public.customer_wallets
  FOR EACH ROW EXECUTE FUNCTION pg_temp.transient_wallet_failure();
SELECT pg_temp.work() AS worker_transient_pass \gset
SELECT pg_temp.check(:worker_transient_pass = 0 AND pg_temp.effect('w-own', 'confirm_credit') = 'requested'
  AND pg_temp.balance(pg_temp.id(70)) = 1000.00, 'a transient failure must leave the request requested');
DROP TRIGGER engine_suite_transient_failure ON public.customer_wallets;

-- The worker applies its own integration's request only.
SELECT pg_temp.work() AS worker_own_pass \gset
SELECT pg_temp.check(:worker_own_pass = 1 AND pg_temp.effect('w-own', 'confirm_credit') = 'applied'
  AND pg_temp.balance(pg_temp.id(70)) = 1020.00, 'the worker applies its own integration''s request');
SELECT pg_temp.check(pg_temp.effect('w-other', 'confirm_credit') = 'requested'
  AND pg_temp.balance(pg_temp.id(13)) = 0.00, 'another integration''s request must stay requested');
DELETE FROM piggyvest_primary.transfer_authorities WHERE integration_id IN (pg_temp.id(5), pg_temp.id(80));
