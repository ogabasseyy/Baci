-- =============================================
-- REGRESSION TEST: guest snapshot inventory proof
--   A paid order row alone must not read as inventory-confirmed in
--   get_guest_payment_reference_snapshot: the finalizer flips
--   payment_status before the inventory-confirm step converges, so a
--   paid row can exist while serialized units are still expiring holds
--   (or missing). The sessionless verify path reports success only when
--   the snapshot's inventory_confirmed proof is true.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/guest_snapshot_inventory_proof.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

-- merchants writes fire the identity-audit trigger, whose canonical writer
-- requires an audit actor (raises audit_actor_required/28000 without one):
-- run fixtures as service_role like the other merchants-seeding replay
-- checks (e.g. repair_booking_rpc, santa_catalog_projection).
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000001';
  v_off_product_id uuid := '9f000000-0000-4000-8000-000000000101';
  v_simple_product_id uuid := '9f000000-0000-4000-8000-000000000102';
  v_anchor_id uuid := '9f000000-0000-4000-8000-000000000103';
  v_durable_product_id uuid := '9f000000-0000-4000-8000-000000000104';
  v_durable_anchor_id uuid := '9f000000-0000-4000-8000-000000000105';
  v_bare_product_id uuid := '9f000000-0000-4000-8000-000000000106';
  v_bare_anchor_id uuid := '9f000000-0000-4000-8000-000000000107';
  v_variant_product_id uuid := '9f000000-0000-4000-8000-000000000108';
  v_variant_id uuid := '9f000000-0000-4000-8000-000000000109';
  v_mixed_product_id uuid := '9f000000-0000-4000-8000-000000000110';
  v_mixed_anchor_id uuid := '9f000000-0000-4000-8000-000000000111';
  v_unlimited_product_id uuid := '9f000000-0000-4000-8000-000000000112';
  v_unlimited_anchor_id uuid := '9f000000-0000-4000-8000-000000000113';
BEGIN
  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    NULL,
    'guest-proof@example.com',
    'Guest Proof',
    'guest-proof'
  );

  -- A: off-policy product needs no proof. B/C/D/F: simple products whose
  -- anchor variant inherits the product policy. E: variant product with
  -- a tracked variant.
  INSERT INTO public.products (id, merchant_id, name, price, status, inventory_tracking_policy)
  VALUES
    (v_off_product_id, v_merchant_id, 'Digital Voucher', 5000, 'active', 'off'),
    (v_simple_product_id, v_merchant_id, 'Tracked Phone', 180000, 'active', 'serialized_strict'),
    (v_durable_product_id, v_merchant_id, 'Durable Phone', 180000, 'active', 'serialized_strict'),
    (v_bare_product_id, v_merchant_id, 'Bare Phone', 180000, 'active', 'serialized_strict'),
    (v_variant_product_id, v_merchant_id, 'Variant Phone', 180000, 'active', 'serialized_strict'),
    (v_mixed_product_id, v_merchant_id, 'Mixed Phone', 180000, 'active', 'serialized_strict'),
    (v_unlimited_product_id, v_merchant_id, 'Unlimited Phone', 180000, 'active', 'serialized_then_unlimited');

  INSERT INTO public.product_variants (
    id, product_id, merchant_id, attributes, price_override,
    inventory_tracking_policy, is_inventory_anchor
  )
  VALUES
    (v_anchor_id, v_simple_product_id, v_merchant_id, '{"is_anchor": true}'::jsonb, 0, 'inherit', true),
    (v_durable_anchor_id, v_durable_product_id, v_merchant_id, '{"is_anchor": true}'::jsonb, 0, 'inherit', true),
    (v_bare_anchor_id, v_bare_product_id, v_merchant_id, '{"is_anchor": true}'::jsonb, 0, 'inherit', true),
    (v_mixed_anchor_id, v_mixed_product_id, v_merchant_id, '{"is_anchor": true}'::jsonb, 0, 'inherit', true),
    (v_unlimited_anchor_id, v_unlimited_product_id, v_merchant_id, '{"is_anchor": true}'::jsonb, 0, 'inherit', true),
    (v_variant_id, v_variant_product_id, v_merchant_id, '{"storage": "128GB"}'::jsonb, 180000, 'serialized_strict', false);

  UPDATE public.products SET has_variants = false, inventory_anchor_variant_id = v_anchor_id WHERE id = v_simple_product_id;
  UPDATE public.products SET has_variants = false, inventory_anchor_variant_id = v_durable_anchor_id WHERE id = v_durable_product_id;
  UPDATE public.products SET has_variants = false, inventory_anchor_variant_id = v_bare_anchor_id WHERE id = v_bare_product_id;
  UPDATE public.products SET has_variants = false, inventory_anchor_variant_id = v_mixed_anchor_id WHERE id = v_mixed_product_id;
  UPDATE public.products SET has_variants = false, inventory_anchor_variant_id = v_unlimited_anchor_id WHERE id = v_unlimited_product_id;
  UPDATE public.products SET has_variants = true WHERE id = v_variant_product_id;

  -- One paid order per scenario, each with a completed transaction.
  INSERT INTO public.orders (
    id, merchant_id, order_number, customer_name, payment_status,
    subtotal, total, source, tracking_token
  )
  VALUES
    ('9f000000-0000-4000-8000-000000000201', v_merchant_id, 'ORD-PROOF-A', 'Proof Customer', 'paid', 5000, 5000, 'physical', 'track-proof-a'),
    ('9f000000-0000-4000-8000-000000000202', v_merchant_id, 'ORD-PROOF-B', 'Proof Customer', 'paid', 180000, 180000, 'physical', 'track-proof-b'),
    ('9f000000-0000-4000-8000-000000000203', v_merchant_id, 'ORD-PROOF-C', 'Proof Customer', 'paid', 180000, 180000, 'physical', 'track-proof-c'),
    ('9f000000-0000-4000-8000-000000000204', v_merchant_id, 'ORD-PROOF-D', 'Proof Customer', 'paid', 180000, 180000, 'physical', 'track-proof-d'),
    ('9f000000-0000-4000-8000-000000000205', v_merchant_id, 'ORD-PROOF-E', 'Proof Customer', 'paid', 180000, 180000, 'physical', 'track-proof-e'),
    ('9f000000-0000-4000-8000-000000000206', v_merchant_id, 'ORD-PROOF-F', 'Proof Customer', 'paid', 360000, 360000, 'physical', 'track-proof-f'),
    ('9f000000-0000-4000-8000-000000000207', v_merchant_id, 'ORD-PROOF-G', 'Proof Customer', 'paid', 180000, 180000, 'physical', 'track-proof-g');

  INSERT INTO public.order_items (
    id, order_id, product_id, variant_id, name, price, quantity, product_match_status
  )
  VALUES
    ('9f000000-0000-4000-8000-000000000301', '9f000000-0000-4000-8000-000000000201', v_off_product_id, NULL, 'Digital Voucher', 5000, 1, 'custom'),
    ('9f000000-0000-4000-8000-000000000302', '9f000000-0000-4000-8000-000000000202', v_simple_product_id, NULL, 'Tracked Phone', 180000, 1, 'unreviewed'),
    ('9f000000-0000-4000-8000-000000000303', '9f000000-0000-4000-8000-000000000203', v_durable_product_id, NULL, 'Durable Phone', 180000, 1, 'unreviewed'),
    ('9f000000-0000-4000-8000-000000000304', '9f000000-0000-4000-8000-000000000204', v_bare_product_id, NULL, 'Bare Phone', 180000, 1, 'unreviewed'),
    ('9f000000-0000-4000-8000-000000000305', '9f000000-0000-4000-8000-000000000205', v_variant_product_id, v_variant_id, 'Variant Phone', 180000, 1, 'unreviewed'),
    ('9f000000-0000-4000-8000-000000000306', '9f000000-0000-4000-8000-000000000206', v_mixed_product_id, NULL, 'Mixed Phone', 180000, 2, 'unreviewed'),
    ('9f000000-0000-4000-8000-000000000307', '9f000000-0000-4000-8000-000000000207', v_unlimited_product_id, NULL, 'Unlimited Phone', 180000, 1, 'unreviewed');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference
  )
  VALUES
    ('9f000000-0000-4000-8000-000000000401', v_merchant_id, '9f000000-0000-4000-8000-000000000201', 'payment', 5000, 'NGN', 'completed', 'paystack', 'GUEST-PROOF-A'),
    ('9f000000-0000-4000-8000-000000000402', v_merchant_id, '9f000000-0000-4000-8000-000000000202', 'payment', 180000, 'NGN', 'completed', 'paystack', 'GUEST-PROOF-B'),
    ('9f000000-0000-4000-8000-000000000403', v_merchant_id, '9f000000-0000-4000-8000-000000000203', 'payment', 180000, 'NGN', 'completed', 'paystack', 'GUEST-PROOF-C'),
    ('9f000000-0000-4000-8000-000000000404', v_merchant_id, '9f000000-0000-4000-8000-000000000204', 'payment', 180000, 'NGN', 'completed', 'paystack', 'GUEST-PROOF-D'),
    ('9f000000-0000-4000-8000-000000000405', v_merchant_id, '9f000000-0000-4000-8000-000000000205', 'payment', 180000, 'NGN', 'completed', 'paystack', 'GUEST-PROOF-E'),
    ('9f000000-0000-4000-8000-000000000406', v_merchant_id, '9f000000-0000-4000-8000-000000000206', 'payment', 360000, 'NGN', 'completed', 'paystack', 'GUEST-PROOF-F'),
    ('9f000000-0000-4000-8000-000000000407', v_merchant_id, '9f000000-0000-4000-8000-000000000207', 'payment', 180000, 'NGN', 'completed', 'paystack', 'GUEST-PROOF-G');

  -- B: still an expiring hold (claim ran, confirm has not). C: durable
  -- hold (confirm converged, or claimed after payment). E: sold unit.
  -- F: one durable plus one still-expiring unit against qty 2.
  INSERT INTO public.variant_inventory (
    id, variant_id, merchant_id, identifier_type, identifier_value,
    status, order_id, order_item_id,
    reserved_at, first_reserved_at, reservation_expires_at
  )
  VALUES
    ('9f000000-0000-4000-8000-000000000501', v_anchor_id, v_merchant_id, 'imei', '911111111111111',
     'reserved', '9f000000-0000-4000-8000-000000000202', '9f000000-0000-4000-8000-000000000302',
     now(), now(), now() + interval '1 hour'),
    ('9f000000-0000-4000-8000-000000000502', v_durable_anchor_id, v_merchant_id, 'imei', '922222222222222',
     'reserved', '9f000000-0000-4000-8000-000000000203', '9f000000-0000-4000-8000-000000000303',
     now(), now(), NULL),
    ('9f000000-0000-4000-8000-000000000503', v_variant_id, v_merchant_id, 'imei', '933333333333333',
     'sold', '9f000000-0000-4000-8000-000000000205', '9f000000-0000-4000-8000-000000000305',
     now(), now(), NULL),
    ('9f000000-0000-4000-8000-000000000504', v_mixed_anchor_id, v_merchant_id, 'imei', '944444444444444',
     'reserved', '9f000000-0000-4000-8000-000000000206', '9f000000-0000-4000-8000-000000000306',
     now(), now(), NULL),
    ('9f000000-0000-4000-8000-000000000505', v_mixed_anchor_id, v_merchant_id, 'imei', '955555555555555',
     'reserved', '9f000000-0000-4000-8000-000000000206', '9f000000-0000-4000-8000-000000000306',
     now(), now(), now() + interval '1 hour');
END $$;

DO $$
DECLARE
  v_confirmed boolean;
  v_order_number text;
BEGIN
  -- A: off-policy items are unconstrained — paid reads confirmed.
  SELECT s.inventory_confirmed, s.order_number INTO v_confirmed, v_order_number
  FROM public.get_guest_payment_reference_snapshot('GUEST-PROOF-A', 'track-proof-a') AS s;
  IF v_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'off-policy paid order must read inventory_confirmed=true';
  END IF;
  IF v_order_number IS DISTINCT FROM 'ORD-PROOF-A' THEN
    RAISE EXCEPTION 'snapshot must keep returning the verification columns';
  END IF;

  -- B: paid row before inventory confirmation — the F8 regression.
  SELECT s.inventory_confirmed INTO v_confirmed
  FROM public.get_guest_payment_reference_snapshot('GUEST-PROOF-B', 'track-proof-b') AS s;
  IF v_confirmed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'paid order with an expiring hold must read inventory_confirmed=false';
  END IF;

  -- C: durably held units read confirmed.
  SELECT s.inventory_confirmed INTO v_confirmed
  FROM public.get_guest_payment_reference_snapshot('GUEST-PROOF-C', 'track-proof-c') AS s;
  IF v_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'paid order with a durable hold must read inventory_confirmed=true';
  END IF;

  -- D: tracked item with no units reads unconfirmed.
  SELECT s.inventory_confirmed INTO v_confirmed
  FROM public.get_guest_payment_reference_snapshot('GUEST-PROOF-D', 'track-proof-d') AS s;
  IF v_confirmed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'paid order with missing units must read inventory_confirmed=false';
  END IF;

  -- E: sold unit on a tracked variant reads confirmed.
  SELECT s.inventory_confirmed INTO v_confirmed
  FROM public.get_guest_payment_reference_snapshot('GUEST-PROOF-E', 'track-proof-e') AS s;
  IF v_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'paid order with a sold unit must read inventory_confirmed=true';
  END IF;

  -- F: one stray expiring unit blocks the proof even at full quantity.
  SELECT s.inventory_confirmed INTO v_confirmed
  FROM public.get_guest_payment_reference_snapshot('GUEST-PROOF-F', 'track-proof-f') AS s;
  IF v_confirmed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'paid order with a stray expiring hold must read inventory_confirmed=false';
  END IF;

  -- G: unlimited-fallback items finalize with missing units by design —
  -- the proof must not hold them pending.
  SELECT s.inventory_confirmed INTO v_confirmed
  FROM public.get_guest_payment_reference_snapshot('GUEST-PROOF-G', 'track-proof-g') AS s;
  IF v_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'paid unlimited-fallback order with no units must read inventory_confirmed=true';
  END IF;
END $$;

ROLLBACK;
