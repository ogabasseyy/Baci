-- Regression check (20261111120000): confirming inventory for a paid order
-- whose only line was typed by staff (no catalogue product) must succeed
-- instead of raising product_not_found.
--
-- Usage:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/inventory_confirmation_unlinked_item.sql

BEGIN;

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
END;
$check$;

ROLLBACK;
