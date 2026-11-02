-- Include-only fixtures for the wallet profile RPC suites
-- (storefront_wallet_phone_update.sql and storefront_wallet_profile_update.sql).
-- Not a standalone check: it carries no BEGIN/ROLLBACK, so the including suite
-- owns the transaction. Runs as the connection role (the table owner), which
-- is the only way to seed piggyvest_primary rows.
--
-- Users (e1f00000-...-0000000000NN) and their customer rows (e1f02000-...NN):
--   01 the caller: live individual at m1 (and a second live row, 11, at m2)
--   02 another user: live individual at m1
--   03 a soft-deleted customer at m1
--   04 a company customer at m1
--   05-09 one onboarding intent each at m1: dispatched, unknown, accepted,
--         verified, rejected (no review reason, no provider ids)
--   10 a live row at m1 whose only intent was detached (customer_id NULL)
--   12-14 one onboarding intent each at m1: routing_pending, rejected for an
--         ownership review, rejected for a routing review (ids kept)
-- The caller also holds a verified intent at m2 (row 11), which must not lock
-- their m1 row. m3 has no customer row for anybody.

DO $fixtures$
DECLARE
  v_m1 uuid := 'e1f01000-0000-4000-8000-000000000001';
  v_m2 uuid := 'e1f01000-0000-4000-8000-000000000002';
  v_m3 uuid := 'e1f01000-0000-4000-8000-000000000003';
  v_i1 uuid := 'e1f03000-0000-4000-8000-000000000001';
  v_i2 uuid := 'e1f03000-0000-4000-8000-000000000002';
BEGIN
  -- Merchant inserts are audited, and the audit writer refuses a write with
  -- no attributable actor (28000 audit_actor_required). Seed as the service
  -- role, as the other suites do, and clear the claim before returning.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  SELECT
    ('e1f00000-0000-4000-8000-0000000000' || u.n)::uuid,
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'swp-u' || u.n || '@example.test', 'test', pg_catalog.now(),
    pg_catalog.now(), pg_catalog.now(), '{}'::jsonb, '{}'::jsonb
  FROM pg_catalog.unnest(ARRAY[
    '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '12', '13', '14'
  ]) AS u(n);

  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES
    (v_m1, 'swp-m1@example.test', 'SWP M1', 'swp-m1'),
    (v_m2, 'swp-m2@example.test', 'SWP M2', 'swp-m2'),
    (v_m3, 'swp-m3@example.test', 'SWP M3', 'swp-m3');

  INSERT INTO public.customers (
    id, merchant_id, user_id, email, first_name, last_name, phone,
    loyalty_points
  )
  SELECT
    ('e1f02000-0000-4000-8000-0000000000' || c.n)::uuid,
    CASE c.n WHEN '11' THEN v_m2 ELSE v_m1 END,
    ('e1f00000-0000-4000-8000-0000000000'
      || CASE c.n WHEN '11' THEN '01' ELSE c.n END)::uuid,
    'swp-u' || CASE c.n WHEN '11' THEN '01' ELSE c.n END || '@example.test',
    'First' || c.n, 'Last' || c.n, '080000001' || c.n, 7
  FROM pg_catalog.unnest(ARRAY[
    '01', '02', '03', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14'
  ]) AS c(n);

  INSERT INTO public.customers (
    id, merchant_id, user_id, email, customer_type, company_name, phone
  )
  VALUES (
    'e1f02000-0000-4000-8000-000000000004', v_m1,
    'e1f00000-0000-4000-8000-000000000004', 'swp-u04@example.test',
    'company', 'SWP Company Ltd', '08000000104'
  );

  UPDATE public.customers SET deleted_at = pg_catalog.now()
  WHERE id = 'e1f02000-0000-4000-8000-000000000003';

  INSERT INTO piggyvest_primary.integrations (
    id, merchant_id, business_id, environment, executor_login, enabled
  )
  VALUES
    (v_i1, v_m1, 'swp-business-1', 'staging', 'swp_fixture_executor_1', true),
    (v_i2, v_m2, 'swp-business-2', 'staging', 'swp_fixture_executor_2', true);

  INSERT INTO piggyvest_primary.onboarding_intents (
    id, integration_id, merchant_id, customer_id, user_id,
    request_fingerprint, state, claim_token,
    provider_customer_id, provider_wallet_id, routing_payout_wallet_id,
    review_reason
  )
  SELECT
    ('e1f04000-0000-4000-8000-0000000000' || i.n)::uuid,
    CASE i.n WHEN '11' THEN v_i2 ELSE v_i1 END,
    CASE i.n WHEN '11' THEN v_m2 ELSE v_m1 END,
    CASE i.n WHEN '10' THEN NULL
      ELSE ('e1f02000-0000-4000-8000-0000000000' || i.n)::uuid END,
    ('e1f00000-0000-4000-8000-0000000000'
      || CASE i.n WHEN '11' THEN '01' ELSE i.n END)::uuid,
    pg_catalog.repeat(pg_catalog.right(i.n, 1), 64),
    i.state,
    CASE i.state WHEN 'dispatched'
      THEN 'e1f05000-0000-4000-8000-000000000005'::uuid END,
    CASE WHEN i.mapped THEN 'swp-pc-' || i.n END,
    CASE WHEN i.mapped THEN 'swp-pw-' || i.n END,
    CASE i.state WHEN 'routing_pending' THEN 'swp-payout-' || i.n END,
    i.review_reason
  FROM (VALUES
    ('05', 'dispatched', false, NULL), ('06', 'unknown', false, NULL),
    ('07', 'accepted', true, NULL), ('08', 'verified', true, NULL),
    ('09', 'rejected', false, NULL), ('10', 'unknown', false, NULL),
    ('11', 'verified', true, NULL), ('12', 'routing_pending', true, NULL),
    ('13', 'rejected', true, 'ownership'), ('14', 'rejected', true, 'routing')
  ) AS i(n, state, mapped, review_reason);

  PERFORM pg_catalog.set_config('request.jwt.claim.role', '', true);
END;
$fixtures$;
