-- Supplemental assertions for the shared MCP cart import fixture.
CREATE FUNCTION pg_temp.check_mcp_import_sku_matching(
  merchant uuid, product uuid, default_variant uuid, source uuid,
  destination uuid, destination_grant uuid, handoff uuid, source_version integer
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  legacy_destination uuid := gen_random_uuid();
  legacy_destination_grant uuid := gen_random_uuid();
  legacy_handoff uuid := gen_random_uuid();
  catalog_gate text;
  result jsonb;
BEGIN
  UPDATE public.commerce_cart_lines SET has_assurance = true WHERE cart_id = destination;
  UPDATE public.commerce_cart_lines SET options = 'null' WHERE cart_id = source AND product_id = product;
  result := public.commerce_cart_import_mcp_handoff('import-test-link', handoff, 'protected-line', source_version);
  IF result->>'code' IS DISTINCT FROM 'invalid_item'
     OR EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE id = handoff AND redeemed_at IS NOT NULL)
  THEN RAISE EXCEPTION 'MCP import must not add to a resolved SKU with assurance: %', result; END IF;
  UPDATE public.commerce_cart_lines SET options = '{}' WHERE cart_id = source AND product_id = product;
  UPDATE public.commerce_cart_lines SET options = 'null' WHERE cart_id = destination;
  result := public.commerce_cart_import_mcp_handoff('import-test-link', handoff, 'protected-destination-options', source_version);
  IF result->>'code' IS DISTINCT FROM 'invalid_item'
     OR EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE id = handoff AND redeemed_at IS NOT NULL)
  THEN RAISE EXCEPTION 'MCP import bypassed assurance on a default SKU with JSON-null options: %', result; END IF;
  UPDATE public.commerce_cart_lines SET has_assurance = false, options = '{}' WHERE cart_id = destination;

  BEGIN
    UPDATE public.commerce_cart_lines SET condition = NULL, has_assurance = true
    WHERE cart_id = destination AND variant_id = default_variant;
    result := public.commerce_cart_import_mcp_handoff('import-test-link', handoff, 'protected-default-sku', source_version);
    IF result->>'code' IS DISTINCT FROM 'invalid_item'
       OR EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE id = handoff AND redeemed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Import bypassed assurance on a default SKU with no stored condition: %', result; END IF;
    UPDATE public.commerce_cart_lines SET has_assurance = false
    WHERE cart_id = destination AND variant_id = default_variant;
    result := public.commerce_cart_import_mcp_handoff('import-test-link', handoff, 'existing-default-sku', source_version);
    IF result->>'ok' IS DISTINCT FROM 'true'
       OR (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id = destination) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id = destination
         AND product_id = product AND variant_id = default_variant AND condition IS NULL AND quantity = 2)
    THEN RAISE EXCEPTION 'Import split a default SKU whose stored condition is null: %', result; END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZT001';
  EXCEPTION WHEN SQLSTATE 'ZT001' THEN
    NULL; -- Restore the explicit-condition fixture for the main import.
  END;

  INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
  VALUES (legacy_destination, merchant, now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
  VALUES (legacy_destination_grant, merchant, legacy_destination, 'website-legacy-import-test', now() + interval '1 day');
  INSERT INTO public.commerce_cart_lines(merchant_id, cart_id, product_id, quantity, last_unit_price_minor, has_assurance)
  VALUES (merchant, legacy_destination, product, 1, 1500, true);
  INSERT INTO public.commerce_cart_handoffs(id, handoff_hash, merchant_id, source_cart_id,
    origin_principal_id, operation_id, destination, expires_at)
  VALUES (legacy_handoff, 'import-legacy-link', merchant, source, 'legacy:mcp:test-import',
    'legacy-handoff:mcp-import:legacy-dest', '{"type":"web"}', now() + interval '5 minutes');
  PERFORM pg_temp.handoff_claim(legacy_destination, legacy_destination_grant, 'website-legacy-import-test');
  result := public.commerce_cart_import_mcp_handoff('import-legacy-link', legacy_handoff, 'legacy-protected', source_version);
  IF result->>'code' IS DISTINCT FROM 'invalid_item'
  THEN RAISE EXCEPTION 'Import bypassed assurance on a legacy product-only line: %', result; END IF;
  UPDATE public.commerce_cart_lines SET options = 'null' WHERE cart_id = legacy_destination;
  result := public.commerce_cart_import_mcp_handoff('import-legacy-link', legacy_handoff, 'legacy-null-options', source_version);
  IF result->>'code' IS DISTINCT FROM 'invalid_item'
     OR EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE id = legacy_handoff AND redeemed_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Import bypassed assurance on a legacy line with JSON-null options: %', result; END IF;
  UPDATE public.commerce_cart_lines SET condition = 'new' WHERE cart_id = legacy_destination;
  result := public.commerce_cart_import_mcp_handoff('import-legacy-link', legacy_handoff, 'legacy-condition-protected', source_version);
  IF result->>'code' IS DISTINCT FROM 'invalid_item'
  THEN RAISE EXCEPTION 'Import bypassed assurance on a condition-carrying product-only line: %', result; END IF;
  UPDATE public.products SET condition = 'open_box' WHERE id = product AND merchant_id = merchant;
  UPDATE public.commerce_cart_lines SET condition = 'refurbished' WHERE cart_id = legacy_destination;
  result := public.commerce_cart_import_mcp_handoff('import-legacy-link', legacy_handoff, 'legacy-alias-protected', source_version);
  IF result->>'code' IS DISTINCT FROM 'invalid_item'
  THEN RAISE EXCEPTION 'Import bypassed assurance on a legacy condition alias: %', result; END IF;
  UPDATE public.commerce_cart_lines SET has_assurance = false, options = '{}' WHERE cart_id = legacy_destination;
  BEGIN
    INSERT INTO public.commerce_cart_lines(merchant_id, cart_id, product_id, condition, quantity, last_unit_price_minor)
    VALUES (merchant, legacy_destination, product, 'open_box', 1, 1500);
    result := public.commerce_cart_import_mcp_handoff('import-legacy-link', legacy_handoff, 'legacy-exact-condition', source_version);
    IF result->>'ok' IS DISTINCT FROM 'true'
       OR (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id = legacy_destination) <> 2
       OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id = legacy_destination
         AND product_id = product AND variant_id IS NULL AND condition = 'open_box' AND quantity = 2)
       OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id = legacy_destination
         AND product_id = product AND variant_id IS NULL AND condition = 'refurbished' AND quantity = 1)
    THEN RAISE EXCEPTION 'Import must increment the exact condition and preserve its alias: %', result; END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZT001';
  EXCEPTION WHEN SQLSTATE 'ZT001' THEN
    NULL; -- Restore the alias-only fixture for the next import.
  END;
  result := public.commerce_cart_import_mcp_handoff('import-legacy-link', legacy_handoff, 'legacy-add', source_version);
  IF result->>'ok' IS DISTINCT FROM 'true'
     OR (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id = legacy_destination) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id = legacy_destination
       AND product_id = product AND variant_id IS NULL AND condition = 'refurbished' AND quantity = 2)
  THEN RAISE EXCEPTION 'Import split an existing product-only line: %', result; END IF;
  UPDATE public.products SET condition = 'new' WHERE id = product AND merchant_id = merchant;

  PERFORM pg_temp.handoff_claim(destination, destination_grant, 'website-import-test');
  FOREACH catalog_gate IN ARRAY ARRAY['active-offer', 'different-price', 'different-condition', 'unknown-condition'] LOOP
    BEGIN
      CASE catalog_gate
        WHEN 'active-offer' THEN
          INSERT INTO public.product_offers(merchant_id, product_id, condition, price, stock_quantity, status)
          VALUES (merchant, product, 'used', 12, 20, 'active');
        WHEN 'different-price' THEN
          UPDATE public.product_variants SET price_override = 16 WHERE id = default_variant;
        WHEN 'different-condition' THEN
          UPDATE public.product_variants SET condition = 'used' WHERE id = default_variant;
        WHEN 'unknown-condition' THEN
          UPDATE public.products SET condition = 'unknown' WHERE id = product AND merchant_id = merchant;
      END CASE;
      result := public.commerce_cart_import_mcp_handoff('import-test-link', handoff, catalog_gate, source_version);
      IF result->>'ok' IS DISTINCT FROM 'true'
         OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id = destination
           AND product_id = product AND variant_id IS NULL AND condition IS NULL AND quantity = 1)
      THEN RAISE EXCEPTION 'Catalog gate % must retain the product-only identity: %', catalog_gate, result; END IF;
      RAISE EXCEPTION USING ERRCODE = 'ZT001';
    EXCEPTION WHEN SQLSTATE 'ZT001' THEN
      NULL; -- Restore the catalog and leave the handoff available for the main test.
    END;
  END LOOP;
END $$;

CREATE FUNCTION pg_temp.check_mcp_import_account_merge(
  merchant uuid, product uuid, default_variant uuid, source uuid,
  destination uuid, source_version integer
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  saved_cart uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  account_user uuid := gen_random_uuid();
  after_merge_handoff uuid := gen_random_uuid();
  result jsonb;
BEGIN
  -- An account merge keeps the saved cart ID and retires the guest cart.
  UPDATE public.merchants SET premium_features = '["shared_cart","shared_cart_accounts"]'
  WHERE id = merchant;
  INSERT INTO public.customers(id, merchant_id, user_id) VALUES (customer, merchant, account_user);
  INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
  VALUES (saved_cart, merchant, now() + interval '1 day');
  INSERT INTO public.commerce_cart_customer_carts(merchant_id, customer_id, cart_id)
  VALUES (merchant, customer, saved_cart);
  PERFORM set_config('request.jwt.claims', (auth.jwt() || jsonb_build_object(
    'role', 'commerce_cart_account_linker', 'cart_customer_id', customer,
    'cart_account_user_id', account_user
  ))::text, true);
  result := public.commerce_cart_link_account(jsonb_build_object(
    'operationId', 'after-mcp-import-merge', 'choice', 'merge', 'expectedSavedCartId', saved_cart,
    'expectedSavedVersion', 1, 'expectedCurrentVersion',
    (SELECT version FROM public.commerce_carts WHERE id = destination),
    'lines', (SELECT jsonb_agg(jsonb_build_object(
      'item', jsonb_strip_nulls(jsonb_build_object(
        'productId', product_id, 'variantId', variant_id, 'condition', condition, 'options', options
      )), 'quantity', quantity
    )) FROM public.commerce_cart_lines WHERE cart_id = destination)
  ), 'import-account-merge', gen_random_uuid(), '{"type":"web"}');
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'cartId' IS DISTINCT FROM saved_cart::text
  THEN RAISE EXCEPTION 'Account merge fixture failed: %', result; END IF;
  PERFORM pg_temp.handoff_claim(saved_cart, (result->>'grantId')::uuid, result->>'principalId');
  INSERT INTO public.commerce_cart_handoffs(id, handoff_hash, merchant_id, source_cart_id,
    origin_principal_id, operation_id, destination, expires_at)
  VALUES (after_merge_handoff, 'import-after-account-merge', merchant, source, 'legacy:mcp:test-import',
    'legacy-handoff:mcp-import:after-account-merge', '{"type":"web"}', now() + interval '5 minutes');
  result := public.commerce_cart_import_mcp_handoff('import-after-account-merge', after_merge_handoff,
    'after-account-merge', source_version);
  IF result->>'replayed' IS DISTINCT FROM 'true'
     OR result->'state'->>'cartId' IS DISTINCT FROM saved_cart::text
     OR (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id = saved_cart AND product_id = product) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id = saved_cart
       AND product_id = product AND variant_id = default_variant AND condition = 'new' AND quantity = 2)
  THEN RAISE EXCEPTION 'Account merge lost the website import history: %', result; END IF;
END $$;
