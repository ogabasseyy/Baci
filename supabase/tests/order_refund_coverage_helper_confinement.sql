-- REGRESSION TEST: refund coverage helper tenant confinement.
--
-- private.capped_refund_coverage_v1 keeps EXECUTE granted to
-- authenticated so denial lands on the clean schema-USAGE check
-- (revoking segfaults, see the migration note). This suite proves the
-- in-function membership gate confines the helper anyway: with
-- private-schema USAGE granted (rolled back), the owner's call
-- succeeds, a foreign merchant's call fails closed with 42501, and
-- uid-less service_role contexts bypass. Fixtures use the 9ef4
-- namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_coverage_helper_confinement.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $confinement_fixtures$
DECLARE
  v_owner_a uuid := '9ef40000-0000-4000-8000-000000000001';
  v_owner_b uuid := '9ef40000-0000-4000-8000-000000000002';
  v_merchant_a uuid := '9ef40100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_a, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'confine-a@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_owner_b, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'confine-b@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_a, v_owner_a, 'confine-a@example.test',
      'Confinement Fixture', 'confinement-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef41000-0000-4000-8000-000000000040', v_merchant_a, 'CONFINE-040',
      100, 100, 'paid', 'cancelled');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef42000-0000-4000-8000-000000000060', v_merchant_a,
      '9ef41000-0000-4000-8000-000000000040', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-40', '{}'::jsonb),
    ('9ef42000-0000-4000-8000-000000000061', v_merchant_a,
      '9ef41000-0000-4000-8000-000000000040', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-40-ok',
      jsonb_build_object(
        'payment_transaction_id', '9ef42000-0000-4000-8000-000000000060',
        'provider_refund_status', 'processed'));

  -- Reach the function body past the schema boundary (rolled back):
  -- the suite asserts production keeps USAGE denied.
  GRANT USAGE ON SCHEMA private TO authenticated;
  GRANT SELECT ON public.transactions TO authenticated;
  GRANT SELECT ON public.merchants TO authenticated;
  CREATE POLICY confinement_probe_transactions
    ON public.transactions FOR SELECT TO authenticated
    USING (true);
  CREATE POLICY confinement_probe_merchants
    ON public.merchants FOR SELECT TO authenticated
    USING (true);
END;
$confinement_fixtures$;

DO $confinement_service_role$
DECLARE
  v_total numeric;
BEGIN
  -- Uid-less service_role contexts bypass the membership gate: the
  -- status trigger and backfills carry no end-user identity.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  SELECT private.capped_refund_coverage_v1(
    '9ef41000-0000-4000-8000-000000000040',
    '9ef40100-0000-4000-8000-000000000001',
    'NGN'
  ) INTO v_total;
  IF v_total <> 100 THEN
    RAISE EXCEPTION 'service_role helper call returned %', v_total;
  END IF;
END;
$confinement_service_role$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef40000-0000-4000-8000-000000000001',
  true
);

DO $confinement_owner$
DECLARE
  v_total numeric;
BEGIN
  SELECT private.capped_refund_coverage_v1(
    '9ef41000-0000-4000-8000-000000000040',
    '9ef40100-0000-4000-8000-000000000001',
    'NGN'
  ) INTO v_total;
  IF v_total <> 100 THEN
    RAISE EXCEPTION 'owner helper call returned %', v_total;
  END IF;
END;
$confinement_owner$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef40000-0000-4000-8000-000000000002',
  true
);

DO $confinement_foreign$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM private.capped_refund_coverage_v1(
      '9ef41000-0000-4000-8000-000000000040',
      '9ef40100-0000-4000-8000-000000000001',
      'NGN'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'cross-tenant helper probe was not rejected';
  END IF;
END;
$confinement_foreign$;

ROLLBACK;
