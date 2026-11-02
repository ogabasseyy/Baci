-- Regression check: the order inventory lifecycle RPCs wrote to
-- public.orders.delivery_address, a column that does not exist, so every call
-- raised 42703 (undefined_column). They must succeed against the replayed
-- schema and write the address to public.orders.shipping_address.
--
-- Usage:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/order_inventory_rpcs_shipping_address.sql

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  'a4270300-0000-4000-8000-000000000001',
  'order-inventory-rpcs-42703@example.com',
  'Order Inventory RPCs 42703',
  'order-inventory-rpcs-42703'
);

INSERT INTO public.orders (id, merchant_id, order_number, total, shipping_status)
VALUES
  ('a4270300-0000-4000-8000-000000000011',
   'a4270300-0000-4000-8000-000000000001', 'RPC-42703-CANCEL', 1000, 'pending'),
  ('a4270300-0000-4000-8000-000000000012',
   'a4270300-0000-4000-8000-000000000001', 'RPC-42703-PROVIDER', 1000, 'pending'),
  ('a4270300-0000-4000-8000-000000000013',
   'a4270300-0000-4000-8000-000000000001', 'RPC-42703-FAILED', 1000, 'pending'),
  ('a4270300-0000-4000-8000-000000000014',
   'a4270300-0000-4000-8000-000000000001', 'RPC-42703-SHIP', 1000, 'pending');

INSERT INTO public.shipments (
  id, order_id, merchant_id, provider, tracking_number,
  sender_address, receiver_address, items
) VALUES (
  'a4270300-0000-4000-8000-000000000021',
  'a4270300-0000-4000-8000-000000000012',
  'a4270300-0000-4000-8000-000000000001',
  'GIGL', 'RPC-42703-PROVIDER', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
);

-- Merchant cancellation with a corrected address.
DO $$
BEGIN
  PERFORM public.cancel_order_and_release_inventory(
    'a4270300-0000-4000-8000-000000000001',
    'a4270300-0000-4000-8000-000000000011',
    'cancelled',
    'Customer changed mind',
    '{"city":"Lagos"}'::jsonb
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = 'a4270300-0000-4000-8000-000000000011'
      AND shipping_status = 'cancelled'
      AND payment_status = 'cancelled'
      AND notes = 'Customer changed mind'
      AND shipping_address = '{"city":"Lagos"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'cancel_order_and_release_inventory did not cancel the order';
  END IF;
END;
$$;

-- Provider cancellation delegates to the same cancel path.
DO $$
BEGIN
  PERFORM public.cancel_provider_shipment_order_and_release_inventory(
    'a4270300-0000-4000-8000-000000000001',
    'a4270300-0000-4000-8000-000000000021',
    500
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = 'a4270300-0000-4000-8000-000000000012'
      AND shipping_status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'provider cancellation did not cancel the order';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shipments
    WHERE id = 'a4270300-0000-4000-8000-000000000021'
      AND status = 'cancelled'
      AND refund_amount = 500
  ) THEN
    RAISE EXCEPTION 'provider cancellation did not cancel the shipment';
  END IF;
END;
$$;

-- A failed payment releases inventory and stores the address.
DO $$
BEGIN
  PERFORM public.mark_order_payment_failed_and_release_inventory(
    'a4270300-0000-4000-8000-000000000001',
    'a4270300-0000-4000-8000-000000000013',
    'failed',
    NULL,
    '{"city":"Abuja"}'::jsonb
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = 'a4270300-0000-4000-8000-000000000013'
      AND payment_status = 'failed'
      AND shipping_address = '{"city":"Abuja"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'mark_order_payment_failed_and_release_inventory did not update the order';
  END IF;
END;
$$;

-- Completing a shipment keeps accepting the `delivery_address` payload key.
DO $$
BEGIN
  PERFORM public.complete_order_shipment_with_inventory(
    'a4270300-0000-4000-8000-000000000001',
    'a4270300-0000-4000-8000-000000000014',
    '[]'::jsonb,
    '{"tracking_number":"TRK-42703","delivery_address":{"city":"Kano"}}'::jsonb
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = 'a4270300-0000-4000-8000-000000000014'
      AND shipping_status = 'shipped'
      AND tracking_number = 'TRK-42703'
      AND shipping_address = '{"city":"Kano"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'complete_order_shipment_with_inventory did not ship the order';
  END IF;
END;
$$;

-- A NULL address leaves the stored one untouched.
DO $$
BEGIN
  UPDATE public.orders
  SET shipping_status = 'pending', shipping_address = '{"city":"Ibadan"}'::jsonb
  WHERE id = 'a4270300-0000-4000-8000-000000000013';
  PERFORM public.cancel_order_and_release_inventory(
    'a4270300-0000-4000-8000-000000000001',
    'a4270300-0000-4000-8000-000000000013'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = 'a4270300-0000-4000-8000-000000000013'
      AND shipping_status = 'cancelled'
      AND shipping_address = '{"city":"Ibadan"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'cancel with NULL address overwrote shipping_address';
  END IF;
END;
$$;

ROLLBACK;
