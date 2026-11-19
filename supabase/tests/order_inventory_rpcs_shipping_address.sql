-- Regression check: the order inventory lifecycle RPCs wrote to
-- public.orders.delivery_address, a column that does not exist, so every call
-- raised 42703 (undefined_column). They must succeed against the replayed
-- schema and write the address to public.orders.shipping_address. Because they
-- authorize any active staff member, they must be executable by service_role
-- only.
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

-- TOPSHIP, not GIGL: GIGL inserts require stored quote economics, which the
-- cancel path does not read.
INSERT INTO public.shipments (
  id, order_id, merchant_id, provider, tracking_number,
  sender_address, receiver_address, items
) VALUES (
  'a4270300-0000-4000-8000-000000000021',
  'a4270300-0000-4000-8000-000000000012',
  'a4270300-0000-4000-8000-000000000001',
  'TOPSHIP', 'RPC-42703-PROVIDER', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
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

-- The live caller: expiring a transferred quiz prize (the claim-expiry path,
-- invoked under the service_role claim) cancels its reserved order through the
-- nested SECURITY DEFINER chain, with no client-role grants. The pg_cron
-- deadline clock only releases untransferred reservations, which never cancel.
RESET ROLE;
INSERT INTO public.customers (id, merchant_id, email, full_name)
VALUES (
  'a4270300-0000-4000-8000-000000000033',
  'a4270300-0000-4000-8000-000000000001',
  'order-inventory-rpcs-42703-winner@example.com', 'Quiz Winner'
);
INSERT INTO public.products (id, merchant_id, name, price, manage_stock, status)
VALUES (
  'a4270300-0000-4000-8000-000000000035',
  'a4270300-0000-4000-8000-000000000001',
  'Quiz prize', 1, false, 'active'
);
INSERT INTO public.orders (id, merchant_id, order_number, total, shipping_status)
VALUES (
  'a4270300-0000-4000-8000-000000000015',
  'a4270300-0000-4000-8000-000000000001', 'RPC-42703-QUIZ', 0, 'pending'
);
INSERT INTO public.quiz_events (id, merchant_id, slug, title, status)
VALUES (
  'a4270300-0000-4000-8000-000000000031',
  'a4270300-0000-4000-8000-000000000001',
  'rpc-42703-quiz', 'RPC 42703 quiz', 'active'
);
-- Seed the transferred award/reservation shape directly; their lifecycle
-- triggers are not under test.
ALTER TABLE public.quiz_awards DISABLE TRIGGER USER;
ALTER TABLE public.quiz_prize_reservations DISABLE TRIGGER USER;
INSERT INTO public.quiz_awards (
  id, event_id, customer_id, award_type, status, amount, reserved_order_id
) VALUES (
  'a4270300-0000-4000-8000-000000000032',
  'a4270300-0000-4000-8000-000000000031',
  'a4270300-0000-4000-8000-000000000033',
  'grand', 'claimed', 0,
  'a4270300-0000-4000-8000-000000000015'
);
INSERT INTO public.quiz_prize_reservations (
  id, event_id, merchant_id, product_id, inventory_kind, state, award_id,
  transferred_at
) VALUES (
  'a4270300-0000-4000-8000-000000000034',
  'a4270300-0000-4000-8000-000000000031',
  'a4270300-0000-4000-8000-000000000001',
  'a4270300-0000-4000-8000-000000000035',
  'unlimited', 'transferred',
  'a4270300-0000-4000-8000-000000000032', now()
);
ALTER TABLE public.quiz_awards ENABLE TRIGGER USER;
ALTER TABLE public.quiz_prize_reservations ENABLE TRIGGER USER;

DO $$
BEGIN
  IF NOT private.release_quiz_prize_reservation_v2(
    'a4270300-0000-4000-8000-000000000031', 'claim_expired'
  ) THEN
    RAISE EXCEPTION 'expired quiz prize was not released';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = 'a4270300-0000-4000-8000-000000000015'
      AND shipping_status = 'cancelled'
      AND payment_status = 'cancelled'
      AND notes = 'Expired quiz prize'
  ) THEN
    RAISE EXCEPTION 'expired quiz prize order was not cancelled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.quiz_prize_reservations
    WHERE id = 'a4270300-0000-4000-8000-000000000034' AND state = 'released'
  ) THEN
    RAISE EXCEPTION 'expired quiz prize reservation was not released';
  END IF;
END;
$$;

-- These bodies only check has_merchant_access (any active staff member), so
-- only service_role may execute them; authenticated callers must not.
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.cancel_order_and_release_inventory(uuid,uuid,text,text,jsonb)',
    'private.cancel_order_and_release_inventory(uuid,uuid,text,text,jsonb)',
    'public.cancel_provider_shipment_order_and_release_inventory(uuid,uuid,numeric,timestamptz)',
    'private.cancel_provider_shipment_order_and_release_inventory(uuid,uuid,numeric,timestamptz)',
    'public.mark_order_payment_failed_and_release_inventory(uuid,uuid,text,text,jsonb)',
    'private.mark_order_payment_failed_and_release_inventory(uuid,uuid,text,text,jsonb)',
    'public.complete_order_shipment_with_inventory(uuid,uuid,jsonb,jsonb)',
    'private.complete_order_shipment_with_inventory(uuid,uuid,jsonb,jsonb)'
  ] LOOP
    IF pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by a client role', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is not executable by service_role', v_fn;
    END IF;
  END LOOP;
END;
$$;

ROLLBACK;
