\set ON_ERROR_STOP on
CREATE SCHEMA provisioning_test;
CREATE FUNCTION provisioning_test.assert_true(actual boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', label; END IF;
END $$;
CREATE FUNCTION provisioning_test.expect_error(statement text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected_state THEN RETURN; END IF;
    RAISE EXCEPTION 'expected SQLSTATE %, got %', expected_state, SQLSTATE;
  END;
  RAISE EXCEPTION 'expected SQLSTATE %, statement succeeded', expected_state;
END $$;
INSERT INTO public.merchants (id) VALUES
  ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.customers (id, merchant_id) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_savings_goals (id, merchant_id, customer_id) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
INSERT INTO piggyvest_staging.integrations (id, expected_provider_account_id, enabled) VALUES
  ('40000000-0000-4000-8000-000000000001', 'synthetic-one', true),
  ('40000000-0000-4000-8000-000000000002', 'synthetic-two', true),
  ('40000000-0000-4000-8000-000000000003', 'synthetic-disabled', false);
INSERT INTO piggyvest_staging.provisioning_integrations (integration_id, merchant_id) VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001');
SELECT provisioning_test.assert_true(NOT EXISTS (
  SELECT 1 FROM piggyvest_staging.provisioning_integrations WHERE enabled), 'provisioning defaults disabled');
SELECT provisioning_test.expect_error($command$
  SELECT piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'))
$command$, '22023');
UPDATE piggyvest_staging.provisioning_integrations SET enabled = true;
SELECT provisioning_test.expect_error($command$
  SELECT piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'))
$command$, '22023');
SELECT provisioning_test.assert_true(NOT EXISTS (
  SELECT 1 FROM piggyvest_staging.provisioning_intents), 'disabled prepares persisted nothing');
