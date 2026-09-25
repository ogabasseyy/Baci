-- =============================================
-- Order inventory proof for the storefront status poll.
--
-- get_order_inventory_proof exposes only the confirmed bit for orders
-- the caller may see (creation tracking token, auth.uid() customer
-- ownership, or merchant view). The serialized_strict proof mirrors
-- the guest payment snapshot: every tracked unit must be sold or
-- expiry-cleared reserved, with nothing else outstanding. Denials
-- read as not confirmed (unknown order, failing authorization, or
-- unconfirmed inventory are indistinguishable — no oracle).
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/credit_direct_inventory_proof.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

-- customers.user_id references auth.users: seed the owner row as the
-- session superuser (service_role cannot write the auth schema).
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('9f000000-0000-4000-8000-000000000819', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'inventory-proof-owner@example.com', 'test', now(), now(), now(), '{}', '{}');

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000811';
  v_customer_id uuid := '9f000000-0000-4000-8000-000000000812';
  v_product_id uuid := '9f000000-0000-4000-8000-000000000813';
  v_anchor_id uuid := '9f000000-0000-4000-8000-000000000814';
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'inventory-proof-regression@example.com',
    'Inventory Proof Regression',
    'inventory-proof-regression'
  );
  INSERT INTO public.customers (id, user_id)
  VALUES (v_customer_id, '9f000000-0000-4000-8000-000000000819');
  INSERT INTO public.products (id, merchant_id, name, price, status, inventory_tracking_policy)
  VALUES (v_product_id, v_merchant_id, 'Proof Phone', 180000, 'active', 'serialized_strict');
  INSERT INTO public.product_variants (
    id, product_id, merchant_id, attributes, price_override,
    inventory_tracking_policy, is_inventory_anchor
  )
  VALUES (v_anchor_id, v_product_id, v_merchant_id, '{"is_anchor": true}'::jsonb, 0, 'inherit', true);
  UPDATE public.products
  SET has_variants = false, inventory_anchor_variant_id = v_anchor_id
  WHERE id = v_product_id;
  -- A: approved with an expiring hold (claim ran, confirm has not).
  -- B: approved with a durable hold (confirm converged). C: sold.
  INSERT INTO public.orders (
    id, merchant_id, order_number, customer_id, customer_name,
    payment_status, subtotal, total, source, tracking_token
  )
  VALUES
    ('9f000000-0000-4000-8000-000000000821', v_merchant_id, 'ORD-INV-PROOF-A', v_customer_id, 'Proof Customer', 'bnpl_approved', 180000, 180000, 'physical', 'track-inv-proof-a'),
    ('9f000000-0000-4000-8000-000000000822', v_merchant_id, 'ORD-INV-PROOF-B', v_customer_id, 'Proof Customer', 'bnpl_approved', 180000, 180000, 'physical', 'track-inv-proof-b'),
    ('9f000000-0000-4000-8000-000000000823', v_merchant_id, 'ORD-INV-PROOF-C', v_customer_id, 'Proof Customer', 'paid', 180000, 180000, 'physical', 'track-inv-proof-c');
  INSERT INTO public.order_items (
    id, order_id, product_id, variant_id, name, price, quantity, product_match_status
  )
  VALUES
    ('9f000000-0000-4000-8000-000000000831', '9f000000-0000-4000-8000-000000000821', v_product_id, NULL, 'Proof Phone', 180000, 1, 'unreviewed'),
    ('9f000000-0000-4000-8000-000000000832', '9f000000-0000-4000-8000-000000000822', v_product_id, NULL, 'Proof Phone', 180000, 1, 'unreviewed'),
    ('9f000000-0000-4000-8000-000000000833', '9f000000-0000-4000-8000-000000000823', v_product_id, NULL, 'Proof Phone', 180000, 1, 'unreviewed');
  INSERT INTO public.variant_inventory (
    id, variant_id, merchant_id, identifier_type, identifier_value,
    status, order_id, order_item_id,
    reserved_at, first_reserved_at, reservation_expires_at
  )
  VALUES
    ('9f000000-0000-4000-8000-000000000841', v_anchor_id, v_merchant_id, 'imei', '933333333333333',
     'reserved', '9f000000-0000-4000-8000-000000000821', '9f000000-0000-4000-8000-000000000831',
     now(), now(), now() + interval '1 hour'),
    ('9f000000-0000-4000-8000-000000000842', v_anchor_id, v_merchant_id, 'imei', '944444444444444',
     'reserved', '9f000000-0000-4000-8000-000000000822', '9f000000-0000-4000-8000-000000000832',
     now(), now(), NULL),
    ('9f000000-0000-4000-8000-000000000843', v_anchor_id, v_merchant_id, 'imei', '955555555555555',
     'sold', '9f000000-0000-4000-8000-000000000823', '9f000000-0000-4000-8000-000000000833',
     now(), now(), NULL);
END;
$$;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  v_proof boolean;
BEGIN
  -- Token holders observe the true bit: expiring holds are not
  -- confirmed, durable holds and sold units are.
  SELECT public.get_order_inventory_proof(
    '9f000000-0000-4000-8000-000000000821', 'track-inv-proof-a'
  ) INTO v_proof;
  ASSERT v_proof = false, 'expiring hold must read unconfirmed';
  SELECT public.get_order_inventory_proof(
    '9f000000-0000-4000-8000-000000000822', 'track-inv-proof-b'
  ) INTO v_proof;
  ASSERT v_proof = true, 'durable hold must read confirmed';
  SELECT public.get_order_inventory_proof(
    '9f000000-0000-4000-8000-000000000823', 'track-inv-proof-c'
  ) INTO v_proof;
  ASSERT v_proof = true, 'sold unit must read confirmed';

  -- No oracle: wrong tokens, missing tokens, and unknown orders all
  -- read as not confirmed.
  SELECT public.get_order_inventory_proof(
    '9f000000-0000-4000-8000-000000000822', 'track-inv-proof-nope'
  ) INTO v_proof;
  ASSERT v_proof = false, 'wrong token must read unconfirmed';
  SELECT public.get_order_inventory_proof(
    '9f000000-0000-4000-8000-000000000822', NULL
  ) INTO v_proof;
  ASSERT v_proof = false, 'missing token must read unconfirmed for anon';
  SELECT public.get_order_inventory_proof(
    '9f000000-0000-4000-8000-000000000899', 'track-inv-proof-b'
  ) INTO v_proof;
  ASSERT v_proof = false, 'unknown order must read unconfirmed';

  -- Privilege shape: the poll reads through the anon client.
  IF NOT pg_catalog.has_function_privilege(
    'anon',
    'public.get_order_inventory_proof(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must execute get_order_inventory_proof(uuid, text)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_order_inventory_proof(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must execute get_order_inventory_proof(uuid, text)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.get_order_inventory_proof(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute get_order_inventory_proof(uuid, text)';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000819', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated', 'sub', '9f000000-0000-4000-8000-000000000819'
  )::text,
  true
);

DO $$
DECLARE
  v_proof boolean;
BEGIN
  -- The owner session authorizes without a token.
  SELECT public.get_order_inventory_proof(
    '9f000000-0000-4000-8000-000000000822', NULL
  ) INTO v_proof;
  ASSERT v_proof = true, 'owner must read confirmed without a token';
END;
$$;

ROLLBACK;
