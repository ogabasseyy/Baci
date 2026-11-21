-- Run after the shared-cart fixture and handoff migrations in a disposable database.
DO $$
DECLARE
  merchant constant uuid := '11111111-1111-4111-8111-111111111111';
  product constant uuid := '44444444-4444-4444-8444-444444444444';
  removed_product constant uuid := '33333333-3333-4333-8333-333333333333';
  removed_line uuid := gen_random_uuid();
  source uuid := gen_random_uuid();
  destination uuid := gen_random_uuid();
  source_grant uuid := gen_random_uuid();
  destination_grant uuid := gen_random_uuid();
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
  guest_cart uuid;
  source_version integer;
  result jsonb;
BEGIN
  INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
  VALUES (source, merchant, now() + interval '1 day'),
         (destination, merchant, now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
  VALUES (source_grant, merchant, source, 'legacy:mcp:test-import', now() + interval '1 day'),
         (destination_grant, merchant, destination, 'website-import-test', now() + interval '1 day');
  INSERT INTO public.commerce_cart_legacy_refs(merchant_id, provider, legacy_hash, cart_id)
  VALUES (merchant, 'mcp', 'import-test-source', source);
  INSERT INTO public.commerce_cart_lines(merchant_id, cart_id, product_id, quantity, last_unit_price_minor)
  VALUES (merchant, source, product, 1, 1500), (merchant, destination, product, 1, 1500);
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
  result := public.commerce_cart_import_mcp_handoff('import-test-link', handoff, 'import-attempt', source_version);
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'grantId' IS DISTINCT FROM destination_grant::text
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination) IS DISTINCT FROM 2::bigint
  THEN RAISE EXCEPTION 'Expected a one-plus-one import retaining the destination grant: %', result; END IF;
  IF EXISTS (
    SELECT 1 FROM public.commerce_cart_lines
    WHERE cart_id = destination AND product_id = removed_product
  ) THEN RAISE EXCEPTION 'A removed MCP item reached the website cart'; END IF;
  IF (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = source) IS DISTINCT FROM 1::bigint
     OR EXISTS (SELECT 1 FROM public.commerce_cart_grants WHERE cart_id = destination AND principal_id = 'legacy:mcp:test-import')
  THEN RAISE EXCEPTION 'Import modified the source or shared recipient access'; END IF;
  result := public.commerce_cart_import_mcp_handoff('import-test-link', handoff, 'reopen-new-attempt', source_version);
  IF result->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Reopening did not replay: %', result; END IF;
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
     OR (SELECT count(*) FROM public.commerce_cart_grants WHERE cart_id = guest_cart
          AND principal_id = 'new-website-import-test') <> 1
     OR EXISTS (SELECT 1 FROM public.commerce_cart_grants WHERE cart_id = guest_cart AND principal_id = 'legacy:mcp:test-import')
  THEN RAISE EXCEPTION 'Bootstrap did not create an independent guest cart: %', result; END IF;
  result := public.commerce_cart_import_mcp_handoff('import-test-link-3', third_handoff, 'bootstrap-retry', source_version);
  IF result->>'replayed' IS DISTINCT FROM 'true' OR (result->'state'->>'cartId')::uuid IS DISTINCT FROM guest_cart
  THEN RAISE EXCEPTION 'Lost bootstrap reply did not recover the same cart: %', result; END IF;

  -- Link cleanup must not discard the quantity already imported.
  DELETE FROM public.commerce_cart_handoffs WHERE id IN (handoff, second_handoff);
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
     OR (SELECT sum(quantity) FROM public.commerce_cart_lines WHERE cart_id = destination AND product_id = removed_product) IS DISTINCT FROM 1::bigint
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
