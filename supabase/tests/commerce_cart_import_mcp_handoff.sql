-- Run after the shared-cart fixture and handoff migrations in a disposable database.
DO $$
DECLARE
  merchant constant uuid := '11111111-1111-4111-8111-111111111111';
  product constant uuid := '44444444-4444-4444-8444-444444444444';
  default_variant constant uuid := '21691862-b5bc-406d-859a-5df9bf98184e';
  removed_product constant uuid := '33333333-3333-4333-8333-333333333333';
  removed_line uuid := gen_random_uuid();
  source uuid := gen_random_uuid();
  destination uuid := gen_random_uuid();
  source_grant uuid := gen_random_uuid();
  destination_grant uuid := gen_random_uuid();
  legacy_destination uuid := gen_random_uuid();
  legacy_destination_grant uuid := gen_random_uuid();
  legacy_handoff uuid := gen_random_uuid();
  handoff uuid := gen_random_uuid();
  second_handoff uuid := gen_random_uuid();
  third_handoff uuid := gen_random_uuid();
  ordinary_handoff uuid := gen_random_uuid();
  changed_handoff uuid := gen_random_uuid();
  reduced_handoff uuid := gen_random_uuid();
  linked_handoff uuid := gen_random_uuid();
  linked_recovery_handoff uuid := gen_random_uuid();
  restored_handoff uuid := gen_random_uuid();
  linked_grant uuid := gen_random_uuid();
  saved_cart uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  account_user uuid := gen_random_uuid();
  after_merge_handoff uuid := gen_random_uuid();
  guest_cart uuid;
  source_version integer;
  imported_version integer;
  catalog_gate text;
  result jsonb;
BEGIN
  INSERT INTO public.product_variants(id, merchant_id, product_id, attributes, condition, price_override, stock_quantity)
  VALUES (default_variant, merchant, product, 'null', NULL, 15, 20);
  -- Inventory anchors are stock bookkeeping rows and cannot be sold as SKUs.
  INSERT INTO public.product_variants(id, merchant_id, product_id, is_inventory_anchor)
  VALUES (gen_random_uuid(), merchant, product, true);
  UPDATE public.products SET condition = 'new', default_variant_id = default_variant
  WHERE id = product AND merchant_id = merchant;
  INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
  VALUES (source, merchant, now() + interval '1 day'),
         (destination, merchant, now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
  VALUES (source_grant, merchant, source, 'legacy:mcp:test-import', now() + interval '1 day'),
         (destination_grant, merchant, destination, 'website-import-test', now() + interval '1 day');
  INSERT INTO public.commerce_cart_legacy_refs(merchant_id, provider, legacy_hash, cart_id)
  VALUES (merchant, 'mcp', 'import-test-source', source);
  INSERT INTO public.commerce_cart_lines(merchant_id, cart_id, product_id, quantity, last_unit_price_minor)
  VALUES (merchant, source, product, 1, 1500);
  INSERT INTO public.commerce_cart_lines(merchant_id, cart_id, product_id, variant_id, condition, quantity, last_unit_price_minor)
  VALUES (merchant, destination, product, default_variant, 'new', 1, 1500);
  INSERT INTO public.commerce_cart_lines(id, merchant_id, cart_id, product_id, quantity, last_unit_price_minor)
  VALUES (removed_line, merchant, source, removed_product, 1, 25000);
  PERFORM pg_temp.handoff_claim(source, source_grant, 'legacy:mcp:test-import');
  result := public.commerce_cart_mutate(source, 'remove-before-handoff', 1,
    jsonb_build_object('type', 'remove', 'lineId', removed_line));
  source_version := (result->>'currentVersion')::integer;
  IF result->>'ok' IS DISTINCT FROM 'true' OR source_version IS DISTINCT FROM 2
  THEN RAISE EXCEPTION 'Expected canonical removal before handoff: %', result; END IF;
  INSERT INTO public.commerce_cart_handoffs(id, handoff_hash, merchant_id, source_cart_id,
    origin_principal_id, operation_id, destination, expires_at)
  VALUES (handoff, 'import-test-link', merchant, source, 'legacy:mcp:test-import', 'legacy-handoff:mcp-import:test-import', '{"type":"web"}', now() + interval '5 minutes'),
         (second_handoff, 'import-test-link-2', merchant, source, 'legacy:mcp:test-import', 'legacy-handoff:mcp-import:test-import', '{"type":"web"}', now() + interval '5 minutes'),
         (third_handoff, 'import-test-link-3', merchant, source, 'legacy:mcp:test-import', 'legacy-handoff:mcp-import:test-import', '{"type":"web"}', now() + interval '5 minutes'),
         (ordinary_handoff, 'ordinary-test-link', merchant, source, 'legacy:mcp:test-import', 'legacy-handoff:ordinary', '{"type":"web"}', now() + interval '5 minutes');
  PERFORM pg_temp.handoff_claim(destination, destination_grant, 'website-import-test');
  result := public.commerce_cart_import_mcp_handoff('ordinary-test-link', ordinary_handoff, 'ordinary-import', source_version);
  IF result->>'code' IS DISTINCT FROM 'not_found'
  THEN RAISE EXCEPTION 'The importer accepted an ordinary handoff: %', result; END IF;
  result := public.commerce_cart_redeem_handoff('ordinary-test-link', ordinary_handoff, 'ordinary-redeem',
    'keep_existing', 'web', destination, source_version, NULL, NULL, NULL);
  IF result->>'ok' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'The generic writer rejected an ordinary handoff: %', result; END IF;
  -- The import-only capability must never select a standard redeem path.
  result := public.commerce_cart_redeem_handoff('import-test-link', handoff, 'wrong-mode',
    'connect', 'web', destination, source_version, NULL, NULL, NULL);
  IF result->>'code' IS DISTINCT FROM 'not_found' OR coalesce(result->>'ok', 'false') = 'true'
  THEN RAISE EXCEPTION 'The generic writer accepted an import-only handoff: %', result; END IF;
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
  result := public.commerce_cart_import_mcp_handoff('import-test-link', handoff, 'import-attempt', source_version);
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'grantId' IS DISTINCT FROM destination_grant::text
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination) IS DISTINCT FROM 2::bigint
  THEN RAISE EXCEPTION 'Expected a one-plus-one import retaining the destination grant: %', result; END IF;
  IF (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id = destination) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id = destination
       AND product_id = product AND variant_id = default_variant AND condition = 'new' AND quantity = 2)
  THEN RAISE EXCEPTION 'Expected the website default SKU to consolidate to one line with quantity two: %', result; END IF;
  IF EXISTS (
    SELECT 1 FROM public.commerce_cart_lines
    WHERE cart_id = destination AND product_id = removed_product
  ) THEN RAISE EXCEPTION 'A removed MCP item reached the website cart'; END IF;
  IF (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = source) IS DISTINCT FROM 1::bigint
     OR EXISTS (SELECT 1 FROM public.commerce_cart_grants WHERE cart_id = destination AND principal_id = 'legacy:mcp:test-import')
  THEN RAISE EXCEPTION 'Import modified the source or shared recipient access'; END IF;
  imported_version := (result->'state'->>'version')::integer;
  IF imported_version IS DISTINCT FROM (SELECT version FROM public.commerce_carts WHERE id = destination)
  THEN RAISE EXCEPTION 'Import did not report the persisted destination version: %', result; END IF;
  result := public.commerce_cart_import_mcp_handoff('import-test-link', handoff, 'reopen-new-attempt', source_version);
  IF result->>'replayed' IS DISTINCT FROM 'true'
     OR (result->'state'->>'version')::integer IS DISTINCT FROM imported_version
     OR (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id = destination) <> 1
     OR (SELECT quantity FROM public.commerce_cart_lines WHERE cart_id = destination) IS DISTINCT FROM 2
  THEN RAISE EXCEPTION 'Reopening changed the consolidated cart: %', result; END IF;
  result := public.commerce_cart_import_mcp_handoff('import-test-link-2', second_handoff, 'second-link', source_version);
  IF result->>'replayed' IS DISTINCT FROM 'true'
     OR result->>'grantId' IS DISTINCT FROM destination_grant::text
     OR (result->'state'->>'cartId')::uuid IS DISTINCT FROM destination
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination) IS DISTINCT FROM 2::bigint
  THEN RAISE EXCEPTION 'A refreshed link did not reopen the cart without duplicates: %', result; END IF;
  -- Reopening cannot mint a broader proof than the existing restricted grant.
  UPDATE public.commerce_cart_grants SET allowed_operations = ARRAY['add'] WHERE id = destination_grant;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role','commerce_cart_shopper','exp',9999999999,'cart_scope','bootstrap',
    'cart_merchant_id',merchant,'cart_principal_id','website-import-test'
  )::text, true);
  result := public.commerce_cart_import_mcp_handoff('import-test-link-2', second_handoff, 'restricted-replay', source_version);
  IF result->>'code' IS DISTINCT FROM 'unauthorized' OR result ? 'state'
  THEN RAISE EXCEPTION 'A bootstrap replay elevated a restricted grant: %', result; END IF;
  -- Different browser with only a bootstrap proof gets a distinct cart.
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role','commerce_cart_shopper','exp',9999999999,'cart_scope','bootstrap',
    'cart_merchant_id',merchant,'cart_principal_id','new-website-import-test'
  )::text, true);
  result := public.commerce_cart_import_mcp_handoff('import-test-link', handoff, 'foreign-replay', source_version);
  IF result->>'code' IS DISTINCT FROM 'handoff_consumed' OR result ? 'state'
  THEN RAISE EXCEPTION 'An unrelated browser replay saw recipient data: %', result; END IF;
  result := public.commerce_cart_import_mcp_handoff('import-test-link-3', third_handoff, 'first-visit', source_version);
  guest_cart := (result->'state'->>'cartId')::uuid;
  IF result->>'ok' IS DISTINCT FROM 'true' OR guest_cart IN (source, destination)
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = guest_cart) IS DISTINCT FROM 1::bigint
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id = guest_cart
       AND product_id = product AND variant_id = default_variant AND condition = 'new')
     OR (SELECT count(*) FROM public.commerce_cart_grants WHERE cart_id = guest_cart
          AND principal_id = 'new-website-import-test') <> 1
     OR EXISTS (SELECT 1 FROM public.commerce_cart_grants WHERE cart_id = guest_cart AND principal_id = 'legacy:mcp:test-import')
  THEN RAISE EXCEPTION 'Bootstrap did not create an independent guest cart: %', result; END IF;
  result := public.commerce_cart_import_mcp_handoff('import-test-link-3', third_handoff, 'bootstrap-retry', source_version);
  IF result->>'replayed' IS DISTINCT FROM 'true' OR (result->'state'->>'cartId')::uuid IS DISTINCT FROM guest_cart
  THEN RAISE EXCEPTION 'Lost bootstrap reply did not recover the same cart: %', result; END IF;

  -- Link cleanup must not discard the quantity already imported.
  DELETE FROM public.commerce_cart_handoffs WHERE id IN (handoff, second_handoff);
  -- A configured default does not make a product with multiple SKUs unambiguous.
  INSERT INTO public.product_variants(id, merchant_id, product_id, attributes, condition, stock_quantity)
  VALUES ('66666666-0000-4000-8000-000000000001', merchant, removed_product, '{}', 'new', 20),
    ('66666666-0000-4000-8000-000000000002', merchant, removed_product, '{"color":"white"}', 'new', 20);
  UPDATE public.products SET condition = 'new', default_variant_id = '66666666-0000-4000-8000-000000000001'
  WHERE id = removed_product AND merchant_id = merchant;
  PERFORM pg_temp.handoff_claim(source, source_grant, 'legacy:mcp:test-import');
  result := public.commerce_cart_mutate(source, 'add-after-handoff', source_version,
    jsonb_build_object('type', 'add', 'item', jsonb_build_object('productId', removed_product), 'quantity', 1));
  IF result->>'ok' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'Could not add a second source item: %', result; END IF;
  source_version := (result->>'currentVersion')::integer;
  INSERT INTO public.commerce_cart_handoffs(id, handoff_hash, merchant_id, source_cart_id,
    origin_principal_id, operation_id, destination, expires_at)
  VALUES (changed_handoff, 'import-updated-link', merchant, source, 'legacy:mcp:test-import',
    'legacy-handoff:mcp-import:updated', '{"type":"web"}', now() + interval '5 minutes');
  UPDATE public.commerce_cart_grants SET allowed_operations =
    ARRAY['add','set_quantity','remove','clear','replace','set_assurance','set_negotiated_price']
  WHERE id = destination_grant;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role','commerce_cart_shopper','exp',9999999999,'cart_scope','bootstrap',
    'cart_merchant_id',merchant,'cart_principal_id','website-import-test'
  )::text, true);
  result := public.commerce_cart_import_mcp_handoff('import-updated-link', changed_handoff, 'forward-update', source_version);
  IF result->>'resumeImport' IS DISTINCT FROM 'true' OR result->>'grantId' IS DISTINCT FROM destination_grant::text
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination) IS DISTINCT FROM 2::bigint
     OR EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE id = changed_handoff AND redeemed_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Bootstrap recovery did not preserve the pending import and cart: %', result; END IF;
  PERFORM pg_temp.handoff_claim(destination, destination_grant, 'website-import-test');
  result := public.commerce_cart_import_mcp_handoff('import-updated-link', changed_handoff, 'forward-update', source_version);
  IF result->>'ok' IS DISTINCT FROM 'true'
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination AND product_id = product) IS DISTINCT FROM 2::bigint
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id = destination
       AND product_id = removed_product AND variant_id IS NULL AND condition IS NULL AND quantity = 1)
  THEN RAISE EXCEPTION 'A new source version did not copy just new quantities: %', result; END IF;
  result := public.commerce_cart_import_mcp_handoff('import-updated-link', changed_handoff, 'repeat-update', source_version);
  IF result->>'replayed' IS DISTINCT FROM 'true'
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination) IS DISTINCT FROM 3::bigint
  THEN RAISE EXCEPTION 'Reopening an updated link duplicated imported quantities: %', result; END IF;

  PERFORM pg_temp.handoff_claim(source, source_grant, 'legacy:mcp:test-import');
  result := public.commerce_cart_mutate(source, 'remove-after-handoff', source_version,
    jsonb_build_object('type', 'remove', 'lineId', (
      SELECT id FROM public.commerce_cart_lines WHERE cart_id = source AND product_id = product
    )));
  IF result->>'ok' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'Could not remove an already transferred source item: %', result; END IF;
  source_version := (result->>'currentVersion')::integer;
  INSERT INTO public.commerce_cart_handoffs(id, handoff_hash, merchant_id, source_cart_id,
    origin_principal_id, operation_id, destination, expires_at)
  VALUES (reduced_handoff, 'import-reduced-link', merchant, source, 'legacy:mcp:test-import',
    'legacy-handoff:mcp-import:reduced', '{"type":"web"}', now() + interval '5 minutes');
  PERFORM pg_temp.handoff_claim(destination, destination_grant, 'website-import-test');
  result := public.commerce_cart_import_mcp_handoff('import-reduced-link', reduced_handoff, 'forward-reduction', source_version);
  IF result->>'ok' IS DISTINCT FROM 'true'
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination) IS DISTINCT FROM 3::bigint
  THEN RAISE EXCEPTION 'A source reduction edited the independent website cart: %', result; END IF;

  -- A shopper can link the same website cart to an account and change grants.
  UPDATE public.commerce_cart_grants SET revoked_at = now() WHERE id = destination_grant;
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
  VALUES (linked_grant, merchant, destination, 'linked-website-import-test', now() + interval '1 day');
  INSERT INTO public.commerce_cart_handoffs(id, handoff_hash, merchant_id, source_cart_id,
    origin_principal_id, operation_id, destination, expires_at)
  VALUES (linked_handoff, 'import-linked-link', merchant, source, 'legacy:mcp:test-import',
    'legacy-handoff:mcp-import:linked', '{"type":"web"}', now() + interval '5 minutes');
  PERFORM pg_temp.handoff_claim(destination, linked_grant, 'linked-website-import-test');
  result := public.commerce_cart_import_mcp_handoff('import-linked-link', linked_handoff, 'after-account-link', source_version);
  IF result->>'replayed' IS DISTINCT FROM 'true' OR result->>'grantId' IS DISTINCT FROM linked_grant::text
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination) IS DISTINCT FROM 3::bigint
  THEN RAISE EXCEPTION 'Changing the website grant duplicated an already transferred source revision: %', result; END IF;

  INSERT INTO public.commerce_cart_handoffs(id, handoff_hash, merchant_id, source_cart_id,
    origin_principal_id, operation_id, destination, expires_at)
  VALUES (linked_recovery_handoff, 'import-linked-recovery', merchant, source, 'legacy:mcp:test-import',
    'legacy-handoff:mcp-import:linked-recovery', '{"type":"web"}', now() + interval '5 minutes');
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role','commerce_cart_shopper','exp',9999999999,'cart_scope','bootstrap',
    'cart_merchant_id',merchant,'cart_principal_id','linked-website-import-test'
  )::text, true);
  result := public.commerce_cart_import_mcp_handoff('import-linked-recovery', linked_recovery_handoff, 'recover-account-link', source_version);
  IF result->>'replayed' IS DISTINCT FROM 'true' OR result->>'grantId' IS DISTINCT FROM linked_grant::text
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination) IS DISTINCT FROM 3::bigint
  THEN RAISE EXCEPTION 'Bootstrap recovery did not use the renewed website authority: %', result; END IF;

  -- Decreases leave website items alone, so later restoring the source
  -- quantity must not recount the units previously transferred.
  PERFORM pg_temp.handoff_claim(source, source_grant, 'legacy:mcp:test-import');
  result := public.commerce_cart_mutate(source, 'restore-source-quantity', source_version,
    jsonb_build_object('type', 'add', 'item', jsonb_build_object('productId', product), 'quantity', 1));
  IF result->>'ok' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'Could not restore the original source quantity: %', result; END IF;
  source_version := (result->>'currentVersion')::integer;
  INSERT INTO public.commerce_cart_handoffs(id, handoff_hash, merchant_id, source_cart_id,
    origin_principal_id, operation_id, destination, expires_at)
  VALUES (restored_handoff, 'import-restored-source', merchant, source, 'legacy:mcp:test-import',
    'legacy-handoff:mcp-import:restored', '{"type":"web"}', now() + interval '5 minutes');
  PERFORM pg_temp.handoff_claim(destination, linked_grant, 'linked-website-import-test');
  result := public.commerce_cart_import_mcp_handoff('import-restored-source', restored_handoff, 'reopen-restored-quantity', source_version);
  IF result->>'ok' IS DISTINCT FROM 'true'
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination AND product_id = product) IS DISTINCT FROM 2::bigint
  THEN RAISE EXCEPTION 'Restoring a source quantity duplicated units already transferred: %', result; END IF;

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

DO $$
DECLARE
  merchant constant uuid := '11111111-1111-4111-8111-111111111111';
  product constant uuid := '44444444-4444-4444-8444-444444444444';
  source uuid := gen_random_uuid();
  destination uuid := gen_random_uuid();
  destination_grant uuid := gen_random_uuid();
  handoff uuid := gen_random_uuid();
  result jsonb;
BEGIN
  IF has_function_privilege('anon', 'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Anonymous imports must be rejected'; END IF;
  IF has_table_privilege('commerce_cart_shopper', 'private.commerce_cart_mcp_imports', 'SELECT')
     OR has_table_privilege('commerce_cart_shopper', 'private.commerce_cart_mcp_imports', 'INSERT')
  THEN RAISE EXCEPTION 'Shoppers must not directly access import snapshots'; END IF;
  INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
  VALUES (source, merchant, now() + interval '1 day'), (destination, merchant, now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants(merchant_id, cart_id, principal_id, expires_at)
  VALUES (merchant, source, 'legacy:mcp:rollback-source', now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
  VALUES (destination_grant, merchant, destination, 'mcp-import-rollback-dest', now() + interval '1 day');
  INSERT INTO public.commerce_cart_legacy_refs(merchant_id, provider, legacy_hash, cart_id)
  VALUES (merchant, 'mcp', 'import-rollback-source', source);
  INSERT INTO public.commerce_cart_lines(id, merchant_id, cart_id, product_id, quantity, last_unit_price_minor)
  VALUES ('11111111-0000-4000-8000-000000000001', merchant, source, product, 1, 1500),
         ('11111111-0000-4000-8000-000000000002', merchant, source, gen_random_uuid(), 1, 1500),
         (gen_random_uuid(), merchant, destination, product, 1, 1500);
  INSERT INTO public.commerce_cart_handoffs(id, handoff_hash, merchant_id, source_cart_id,
    origin_principal_id, operation_id, destination, expires_at)
  VALUES (handoff, 'import-rollback-link', merchant, source, 'legacy:mcp:rollback-source',
    'legacy-handoff:mcp-import:rollback-test', '{"type":"web"}', now() + interval '5 minutes');
  PERFORM pg_temp.handoff_claim(destination, destination_grant, 'mcp-import-rollback-dest');
  result := public.commerce_cart_import_mcp_handoff('import-rollback-link', handoff, 'rollback-attempt', 1);
  IF result->>'ok' IS DISTINCT FROM 'false'
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination) IS DISTINCT FROM 1::bigint
     OR (SELECT version FROM public.commerce_carts WHERE id = destination) IS DISTINCT FROM 1
     OR EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE id = handoff AND redeemed_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Failed line left a partial import: %', result; END IF;
END $$;
