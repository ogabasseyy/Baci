-- An authenticated merchant does not need private schema access to save a
-- transaction-only unit cost and supplier. The offer snapshot remains guarded.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) VALUES (
  '00000000-0000-4000-8000-00000000f510',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'transaction-offer-guard@example.com', 'test', now(), now(), now(), '{}', '{}'
);

INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES (
  '00000000-0000-4000-8000-00000000f511', '00000000-0000-4000-8000-00000000f510',
  'transaction-offer-guard@example.com', 'Transaction Offer Guard Test', 'transaction-offer-guard-test'
);

INSERT INTO public.products (id, merchant_id, name, price, status, cost_price)
VALUES (
  '00000000-0000-4000-8000-00000000f512', '00000000-0000-4000-8000-00000000f511',
  'Test product', 250000, 'active', 200000
);

INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, payment_status, payment_method,
  subtotal, total, source, transaction_date
) VALUES (
  '00000000-0000-4000-8000-00000000f513', '00000000-0000-4000-8000-00000000f511',
  'ORD-TRX-OFFER-GUARD', 'Test Customer', 'paid', 'transfer',
  250000, 250000, 'physical', now()
);

INSERT INTO public.order_items (id, order_id, product_id, name, price, quantity, cost_price, supplier_name)
VALUES (
  '00000000-0000-4000-8000-00000000f514', '00000000-0000-4000-8000-00000000f513',
  '00000000-0000-4000-8000-00000000f512', 'Test product', 250000, 1, 170000, 'Old Supplier'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000f510', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
BEGIN
  IF has_schema_privilege(current_user, 'private', 'USAGE') THEN
    RAISE EXCEPTION 'Regression fixture must run without private schema access';
  END IF;

  PERFORM public.update_transaction_review_details(
    '00000000-0000-4000-8000-00000000f511',
    '00000000-0000-4000-8000-00000000f513',
    '00000000-0000-4000-8000-00000000f514',
    '00000000-0000-4000-8000-00000000f512',
    NULL, 215000, 'Test Supplier', now(), 'Africa/Lagos', false
  );

  BEGIN
    UPDATE public.order_items
    SET offer_line = true
    WHERE id = '00000000-0000-4000-8000-00000000f514';

    RAISE EXCEPTION 'Authenticated snapshot mutation was not rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'order_items.offer_line is immutable%' THEN
      RAISE;
    END IF;
  END;
END
$$;

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM public.order_items
    WHERE id = '00000000-0000-4000-8000-00000000f514'
      AND cost_price = 215000 AND supplier_name = 'Test Supplier'
      AND offer_line IS FALSE AND offer_id_snapshot IS NULL
  ) THEN
    RAISE EXCEPTION 'Expected cost and supplier save without a snapshot change';
  END IF;

  IF NOT EXISTS (
    SELECT FROM public.products
    WHERE id = '00000000-0000-4000-8000-00000000f512' AND cost_price = 200000
  ) THEN
    RAISE EXCEPTION 'Unexpected catalog default change';
  END IF;
END
$$;

ROLLBACK;
