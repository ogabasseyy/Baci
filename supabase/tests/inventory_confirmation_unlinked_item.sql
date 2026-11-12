-- Regression check (20261111120000): confirming inventory for a paid order
-- whose only line was typed by staff (no catalogue product) must succeed
-- instead of raising product_not_found.
--
-- Usage:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/inventory_confirmation_unlinked_item.sql

BEGIN;

SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'unlinked-item-actor@example.com'
);

INSERT INTO public.merchants (id, email, user_id, country)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'unlinked-item@example.com',
  '22222222-2222-4222-8222-222222222222',
  'NG'
);

INSERT INTO public.orders (
  id, merchant_id, order_number, total, subtotal, source, shipping_status,
  payment_status
)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'UNLINKED-ITEM-1', 9000.00, 9000.00, 'physical', 'pending', 'paid'
);

UPDATE public.orders
SET fulfillment_details = '{"identifierType":"serial","identifierValue":"SN-TYPED-1"}'::jsonb
WHERE id = '33333333-3333-4333-8333-333333333333';

INSERT INTO public.order_items (
  order_id, name, price, quantity, product_match_status
)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  'Typed laptop line', 9000.00, 1, 'custom'
);

DO $check$
DECLARE
  v_result jsonb;
BEGIN
  v_result := private.confirm_order_inventory_reservations(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333'
  );

  IF (v_result ->> 'missingUnitCount')::integer IS DISTINCT FROM 0
     OR (v_result ->> 'confirmedUnitCount')::integer IS DISTINCT FROM 0
     OR v_result -> 'exceptionCodes' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'unexpected confirmation result for unlinked item: %', v_result;
  END IF;

  IF (
    SELECT fulfillment_details ->> 'identifierValue'
    FROM public.orders
    WHERE id = '33333333-3333-4333-8333-333333333333'
  ) IS DISTINCT FROM 'SN-TYPED-1' THEN
    RAISE EXCEPTION 'order fulfillment details for a sole unlinked line were overwritten';
  END IF;
END;
$check$;

-- Mixed invoice: one catalogue line with tracked stock (no units on hand)
-- plus one typed line. The tracked line must still be processed and
-- reported while the typed line is skipped.
INSERT INTO public.products (
  id, merchant_id, name, price, slug, status, manage_stock, stock_quantity,
  inventory_tracking_policy
)
VALUES (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  'Tracked laptop', 5000.00, 'tracked-laptop', 'active', true, 0,
  'serialized_then_unlimited'
);

INSERT INTO public.orders (
  id, merchant_id, order_number, total, subtotal, source, shipping_status,
  payment_status
)
VALUES (
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  'UNLINKED-ITEM-2', 14000.00, 14000.00, 'physical', 'pending', 'paid'
);

INSERT INTO public.order_items (
  id, order_id, product_id, name, price, quantity, product_match_status
)
VALUES
  (
    '66666666-6666-4666-8666-666666666666',
    '55555555-5555-4555-8555-555555555555',
    '44444444-4444-4444-8444-444444444444',
    'Tracked laptop', 5000.00, 1, 'linked'
  ),
  (
    '77777777-7777-4777-8777-777777777777',
    '55555555-5555-4555-8555-555555555555',
    NULL,
    'Typed charger line', 9000.00, 1, 'custom'
  );

DO $mixed$
DECLARE
  v_result jsonb;
BEGIN
  v_result := private.confirm_order_inventory_reservations(
    '11111111-1111-4111-8111-111111111111',
    '55555555-5555-4555-8555-555555555555'
  );

  IF (v_result ->> 'missingUnitCount')::integer IS DISTINCT FROM 1
     OR v_result -> 'exceptionCodes' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'unexpected confirmation result for mixed order: %', v_result;
  END IF;

  IF (
    SELECT fulfillment_data ->> 'source'
    FROM public.order_items
    WHERE id = '66666666-6666-4666-8666-666666666666'
  ) IS DISTINCT FROM 'merchant_stock' THEN
    RAISE EXCEPTION 'tracked line fulfillment_data was not written';
  END IF;

  IF (
    SELECT fulfillment_data
    FROM public.order_items
    WHERE id = '77777777-7777-4777-8777-777777777777'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'typed line should be skipped by inventory confirmation';
  END IF;
END;
$mixed$;

-- Sole linked line whose product does not track stock: the loop skips it, so
-- there is no confirmation payload and staff-saved order details must stay.
INSERT INTO public.products (
  id, merchant_id, name, price, slug, status, manage_stock, stock_quantity,
  inventory_tracking_policy
)
VALUES (
  '88888888-8888-4888-8888-888888888888',
  '11111111-1111-4111-8111-111111111111',
  'Untracked laptop', 7000.00, 'untracked-laptop', 'active', false, 0,
  'off'
);

INSERT INTO public.orders (
  id, merchant_id, order_number, total, subtotal, source, shipping_status,
  payment_status
)
VALUES (
  '99999999-9999-4999-8999-999999999999',
  '11111111-1111-4111-8111-111111111111',
  'UNLINKED-ITEM-3', 7000.00, 7000.00, 'physical', 'pending', 'paid'
);

UPDATE public.orders
SET fulfillment_details = '{"identifierType":"serial","identifierValue":"SN-UNTRACKED-1"}'::jsonb
WHERE id = '99999999-9999-4999-8999-999999999999';

INSERT INTO public.order_items (
  order_id, product_id, name, price, quantity, product_match_status
)
VALUES (
  '99999999-9999-4999-8999-999999999999',
  '88888888-8888-4888-8888-888888888888',
  'Untracked laptop', 7000.00, 1, 'linked'
);

DO $untracked$
DECLARE
  v_result jsonb;
BEGIN
  v_result := private.confirm_order_inventory_reservations(
    '11111111-1111-4111-8111-111111111111',
    '99999999-9999-4999-8999-999999999999'
  );

  IF v_result -> 'exceptionCodes' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'unexpected confirmation result for untracked line: %', v_result;
  END IF;

  IF (
    SELECT fulfillment_details ->> 'identifierValue'
    FROM public.orders
    WHERE id = '99999999-9999-4999-8999-999999999999'
  ) IS DISTINCT FROM 'SN-UNTRACKED-1' THEN
    RAISE EXCEPTION 'order fulfillment details for a sole untracked line were wiped';
  END IF;
END;
$untracked$;

ROLLBACK;
