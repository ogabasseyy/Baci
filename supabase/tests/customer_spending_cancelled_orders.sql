-- Run against an isolated PostgreSQL fixture with the real trigger installed.
BEGIN;

INSERT INTO public.customers (id, total_orders, total_spent) VALUES
  ('6a000000-0000-4000-8000-000000000001', 0, 0),
  ('6a000000-0000-4000-8000-000000000002', 0, 0);

INSERT INTO public.orders (id, customer_id, total, payment_status, shipping_status) VALUES
  ('6a000000-0000-4000-8000-000000000101', '6a000000-0000-4000-8000-000000000001', 3030000, 'paid', 'processing'),
  ('6a000000-0000-4000-8000-000000000102', '6a000000-0000-4000-8000-000000000001', 2730000, 'paid', 'processing');

UPDATE public.orders SET shipping_status = 'cancelled'
WHERE id = '6a000000-0000-4000-8000-000000000101';
DO $$ BEGIN
  IF (SELECT total_spent FROM public.customers WHERE id = '6a000000-0000-4000-8000-000000000001') <> 2730000 THEN
    RAISE EXCEPTION 'cancelled paid order inflated customer spending';
  END IF;
END $$;

-- An unrelated update must not restore the cancelled order to the total.
UPDATE public.orders SET total = 2730000 WHERE id = '6a000000-0000-4000-8000-000000000102';
DO $$ BEGIN
  IF (SELECT total_spent FROM public.customers WHERE id = '6a000000-0000-4000-8000-000000000001') <> 2730000 THEN
    RAISE EXCEPTION 'unrelated update restored cancelled order';
  END IF;
END $$;

UPDATE public.orders SET customer_id = '6a000000-0000-4000-8000-000000000002'
WHERE id = '6a000000-0000-4000-8000-000000000102';
DO $$ BEGIN
  IF (SELECT total_spent FROM public.customers WHERE id = '6a000000-0000-4000-8000-000000000001') <> 0
    OR (SELECT total_orders FROM public.customers WHERE id = '6a000000-0000-4000-8000-000000000001') <> 1
    OR (SELECT total_spent FROM public.customers WHERE id = '6a000000-0000-4000-8000-000000000002') <> 2730000 THEN
    RAISE EXCEPTION 'customer relink left incorrect aggregates';
  END IF;
END $$;

INSERT INTO public.orders (id, customer_id, total, payment_status, shipping_status) VALUES
  ('6a000000-0000-4000-8000-000000000103', '6a000000-0000-4000-8000-000000000002', 100, ' Paid ', ' CANCELED '),
  ('6a000000-0000-4000-8000-000000000104', '6a000000-0000-4000-8000-000000000002', 200, 'pending', 'processing'),
  ('6a000000-0000-4000-8000-000000000105', '6a000000-0000-4000-8000-000000000002', 300, ' Paid ', 'returned');
DO $$ BEGIN
  IF (SELECT total_spent FROM public.customers WHERE id = '6a000000-0000-4000-8000-000000000002') <> 2730300 THEN
    RAISE EXCEPTION 'status normalization or returned-order behavior incorrect';
  END IF;
END $$;

DELETE FROM public.orders WHERE id = '6a000000-0000-4000-8000-000000000102';
DO $$ BEGIN
  IF (SELECT total_spent FROM public.customers WHERE id = '6a000000-0000-4000-8000-000000000002') <> 300 THEN
    RAISE EXCEPTION 'deleting a paid order failed to refresh spending';
  END IF;
END $$;

ROLLBACK;
