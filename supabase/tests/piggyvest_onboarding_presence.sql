-- Synthetic, transaction-local fixture: this contract must not depend on a
-- staging customer or a previously recorded PiggyVest operation.
BEGIN;
-- Model the separately provisioned LOGIN and its sole restricted capability
-- group inside this disposable transaction; the production migration creates
-- only the NOLOGIN group role.
CREATE ROLE baci_piggyvest_primary_provisioner LOGIN INHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT piggyvest_primary_provisioner TO baci_piggyvest_primary_provisioner;
INSERT INTO auth.users (id, email) VALUES
  ('f3800000-0000-4000-8000-000000000001', 'piggyvest-presence@example.test');
-- Merchant insert audit triggers require an attributable actor even though the
-- fixture is created by the replay administrator. Bind only this insert to the
-- synthetic owner, then clear the request claims before exercising worker RPCs.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3800000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3800000-0000-4000-8000-000000000002', 'f3800000-0000-4000-8000-000000000001',
   'piggyvest-presence@example.test', 'PiggyVest Presence Fixture', 'piggyvest-presence-fixture');
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('f3800000-0000-4000-8000-000000000003', 'f3800000-0000-4000-8000-000000000002',
   'f3800000-0000-4000-8000-000000000001', 'piggyvest-customer@example.test');
INSERT INTO piggyvest_primary.integrations
  (id, merchant_id, business_id, environment, executor_login, enabled)
VALUES ('f3800000-0000-4000-8000-000000000004', 'f3800000-0000-4000-8000-000000000002',
  'synthetic-presence-business', 'staging', 'baci_piggyvest_primary_provisioner', true);
SELECT set_config('test.scope', jsonb_build_object(
  'merchantId', 'f3800000-0000-4000-8000-000000000002',
  'customerId', 'f3800000-0000-4000-8000-000000000003',
  'userId', 'f3800000-0000-4000-8000-000000000001',
  'integrationId', 'f3800000-0000-4000-8000-000000000004',
  'businessId', 'synthetic-presence-business', 'environment', 'staging')::text, true);

SET SESSION AUTHORIZATION baci_piggyvest_primary_provisioner;
DO $test$
BEGIN
  IF piggyvest_primary.has_onboarding(current_setting('test.scope')::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Never-started account was reported pending';
  END IF;
  BEGIN
    PERFORM piggyvest_primary.has_onboarding(current_setting('test.scope')::jsonb ||
      jsonb_build_object('userId','00000000-0000-4000-8000-000000000000'));
    RAISE EXCEPTION 'Foreign user accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$test$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
