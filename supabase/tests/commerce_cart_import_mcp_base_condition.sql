-- Run in the disposable MCP import fixture.
DO $test$
DECLARE
  merchant constant uuid := '11111111-1111-4111-8111-111111111111';
  product uuid := gen_random_uuid();
  source uuid := gen_random_uuid();
  destination uuid := gen_random_uuid();
  destination_grant uuid := gen_random_uuid();
  destination_line uuid := gen_random_uuid();
  handoff uuid := gen_random_uuid();
  result jsonb;
  imported_version integer;
  catalog_gate text;
BEGIN
  INSERT INTO public.products(id, merchant_id, price, status, stock, stock_quantity, condition)
  VALUES (product, merchant, 66700, 'active', 5, 5, 'new');
  INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
  VALUES (source, merchant, now() + interval '1 day'),
         (destination, merchant, now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
  VALUES (gen_random_uuid(), merchant, source, 'legacy:mcp:base-condition', now() + interval '1 day'),
         (destination_grant, merchant, destination, 'web-base-condition', now() + interval '1 day');
  INSERT INTO public.commerce_cart_legacy_refs(merchant_id, provider, legacy_hash, cart_id)
  VALUES (merchant, 'mcp', 'base-condition-source', source);
  INSERT INTO public.commerce_cart_lines(id, merchant_id, cart_id, product_id, condition, quantity, last_unit_price_minor)
  VALUES (gen_random_uuid(), merchant, source, product, NULL, 1, 6670000),
         (destination_line, merchant, destination, product, 'new', 1, 6670000);
  INSERT INTO public.commerce_cart_handoffs(id, handoff_hash, merchant_id, source_cart_id,
    origin_principal_id, operation_id, destination, expires_at)
  VALUES (handoff, 'base-condition-link', merchant, source, 'legacy:mcp:base-condition',
    'legacy-handoff:mcp-import:base-condition', '{"type":"web"}', now() + interval '5 minutes');
  PERFORM pg_temp.handoff_claim(destination, destination_grant, 'web-base-condition');

  UPDATE public.commerce_cart_lines SET has_assurance = true WHERE id = destination_line;
  result := public.commerce_cart_import_mcp_handoff('base-condition-link', handoff, 'with-assurance', 1);
  IF result->>'code' IS DISTINCT FROM 'invalid_item'
     OR EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE id = handoff AND redeemed_at IS NOT NULL)
  THEN RAISE EXCEPTION 'The base condition match must respect destination assurance: %', result; END IF;
  UPDATE public.commerce_cart_lines SET has_assurance = false WHERE id = destination_line;

  FOREACH catalog_gate IN ARRAY ARRAY['active-offer', 'sku-matrix'] LOOP
    BEGIN
      IF catalog_gate = 'active-offer' THEN
        INSERT INTO public.product_offers(merchant_id, product_id, condition, price, stock_quantity, status)
        VALUES (merchant, product, 'used', 50000, 1, 'active');
      ELSE
        UPDATE public.products SET variant_model = 'sku_matrix' WHERE id = product;
      END IF;
      result := public.commerce_cart_import_mcp_handoff('base-condition-link', handoff, catalog_gate, 1);
      IF result->>'ok' IS DISTINCT FROM 'true'
         OR (SELECT l.quantity FROM public.commerce_cart_lines l WHERE l.id = destination_line) IS DISTINCT FROM 1
         OR NOT EXISTS (
           SELECT 1 FROM public.commerce_cart_lines l WHERE l.cart_id = destination
             AND l.product_id = product AND l.condition IS NULL AND l.quantity = 1
         )
      THEN RAISE EXCEPTION 'Catalog gate % must prevent implicit base matching: %', catalog_gate, result; END IF;
      RAISE EXCEPTION USING ERRCODE = 'ZT001';
    EXCEPTION WHEN SQLSTATE 'ZT001' THEN
      NULL; -- Restore the single-condition catalog before testing the match.
    END;
  END LOOP;

  -- The storefront labels legacy products with a null catalog condition as new.
  BEGIN
    UPDATE public.products SET condition = NULL WHERE id = product;
    result := public.commerce_cart_import_mcp_handoff('base-condition-link', handoff, 'null-catalog-condition', 1);
    IF result->>'ok' IS DISTINCT FROM 'true'
       OR (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id = destination) <> 1
       OR (SELECT l.quantity FROM public.commerce_cart_lines l WHERE l.id = destination_line) IS DISTINCT FROM 2
    THEN RAISE EXCEPTION 'Missing catalog condition must match the storefront new default: %', result; END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZT001';
  EXCEPTION WHEN SQLSTATE 'ZT001' THEN
    NULL; -- Restore the catalog and unredeemed handoff for the explicit condition test.
  END;

  result := public.commerce_cart_import_mcp_handoff('base-condition-link', handoff, 'first-open', 1);
  IF result->>'ok' IS DISTINCT FROM 'true'
     OR result->>'grantId' IS DISTINCT FROM destination_grant::text
     OR (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id = destination) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.commerce_cart_lines l WHERE l.id = destination_line
         AND l.condition = 'new' AND l.quantity = 2 AND l.variant_id IS NULL
     )
  THEN RAISE EXCEPTION 'A new base product must keep one website line at quantity two: %', result; END IF;

  imported_version := (result->'state'->>'version')::integer;
  result := public.commerce_cart_import_mcp_handoff('base-condition-link', handoff, 'second-open', 1);
  IF result->>'replayed' IS DISTINCT FROM 'true'
     OR (result->'state'->>'version')::integer IS DISTINCT FROM imported_version
     OR (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id = destination) <> 1
     OR (SELECT l.quantity FROM public.commerce_cart_lines l WHERE l.id = destination_line) IS DISTINCT FROM 2
     OR NOT EXISTS (
       SELECT 1 FROM public.commerce_cart_lines l WHERE l.cart_id = source
         AND l.product_id = product AND l.condition IS NULL AND l.quantity = 1
     )
  THEN RAISE EXCEPTION 'Reopening must keep the website quantity and source identity: %', result; END IF;
END $test$;
