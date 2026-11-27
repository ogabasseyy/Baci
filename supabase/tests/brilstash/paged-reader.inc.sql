SAVEPOINT paged_reader;
UPDATE private.brilstash_installations SET admission = 'suspended', retired_at = now()
WHERE id = '30000000-0000-4000-8000-000000000001';
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000003');
INSERT INTO private.brilstash_installations(id, merchant_id, partner_identity, single_page_only, source_on_demand)
VALUES ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'fixture-paged', :brilstash_on_demand, :brilstash_on_demand);
SELECT set_config('fixture.on_demand_feed', :'brilstash_on_demand', true);
INSERT INTO private.brilstash_builder_entitlements
VALUES ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003');
INSERT INTO private.brilstash_category_mappings VALUES
  ('30000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', 'Phones');
INSERT INTO public.products (
  id, merchant_id, status, name, slug, category_id, condition, price, images,
  has_variants, has_condition_offers, stock_quantity, stock, manage_stock, inventory_tracking_policy
)
SELECT ('41000000-0000-4000-8000-00000000000' || n)::uuid,
  '20000000-0000-4000-8000-000000000001', 'active', 'Fixture ' || n, 'paged-' || n,
  '50000000-0000-4000-8000-000000000001', 'new', (CASE WHEN :brilstash_on_demand THEN 180000 ELSE 50000 END) + n * 70000, '["https://MEDIA.example.invalid.:443/approved"]'::jsonb,
  false, false, n, n, NOT :brilstash_on_demand, 'off'
FROM generate_series(1, 7) n;
\if :brilstash_on_demand
\else
UPDATE public.products SET has_condition_offers = true WHERE slug = 'paged-2';
INSERT INTO public.product_offers (id, merchant_id, product_id, condition, status, price, stock_quantity, images)
SELECT '43000000-0000-4000-8000-000000000002', merchant_id, id, 'used', 'active', price, stock_quantity, images
FROM public.products WHERE slug = 'paged-2';
\endif
-- An internal inventory anchor does not change a simple listing into a
-- variant listing. The simple listing must still stage, activate, and serve.
INSERT INTO public.product_variants (
  id, merchant_id, product_id, condition, attributes, is_inventory_anchor,
  stock_quantity, inventory_tracking_policy
) VALUES
  ('42000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000001', 'new', '{}'::jsonb, true, 99, 'inherit');
UPDATE public.products SET inventory_anchor_variant_id = '42000000-0000-4000-8000-000000000001'
WHERE slug = 'paged-1';

INSERT INTO public.product_feed_images (
  id, merchant_id, product_id, status, verified_url, is_primary, position, source_url
)
SELECT gen_random_uuid(), merchant_id, id, 'verified', 'https://MEDIA.example.invalid.:443/approved',
  true, 1, 'https://MEDIA.example.invalid.:443/approved'
FROM public.products WHERE slug LIKE 'paged-%';
UPDATE public.products
SET images = images || '["https://media.example.invalid/approved","https://media.example.invalid/secondary"]'::jsonb
WHERE slug = 'paged-1';
INSERT INTO public.product_feed_images (
  id, merchant_id, product_id, status, verified_url, is_primary, position, source_url
)
SELECT gen_random_uuid(), merchant_id, id, 'verified', new_image.url,
  false, new_image.position, new_image.url
FROM public.products
CROSS JOIN (VALUES ('https://media.example.invalid/approved', 2),
  ('https://media.example.invalid/secondary', 3)) new_image(url, position)
WHERE slug = 'paged-1';
INSERT INTO private.brilstash_listings (
  id, installation_id, source_kind, source_id, parent_product_id, external_id, pilot_slot, reviewed_identity
)
SELECT ('61000000-0000-4000-8000-00000000000' || n)::uuid, '30000000-0000-4000-8000-000000000003',
  CASE WHEN n = 2 AND NOT :brilstash_on_demand THEN 'offer' ELSE 'product' END,
  CASE WHEN n = 2 AND NOT :brilstash_on_demand THEN '43000000-0000-4000-8000-000000000002'::uuid ELSE product_id END,
  product_id, 'paged-' || n, n, jsonb_build_object('condition', CASE WHEN n = 2 AND NOT :brilstash_on_demand THEN 'used' ELSE 'new' END)
FROM generate_series(1, 7) n
CROSS JOIN LATERAL (SELECT ('41000000-0000-4000-8000-00000000000' || n)::uuid AS product_id) fixture;
INSERT INTO private.brilstash_listing_facts (
  installation_id, listing_id, revision, specifications, box_contents, warranty, evidence_reference, reviewed_by
)
SELECT installation_id, id, 1, 'Fixture specification', 'Phone only', '30 days', 'Fixture evidence',
  '10000000-0000-4000-8000-000000000002'
FROM private.brilstash_listings WHERE installation_id = '30000000-0000-4000-8000-000000000003';
UPDATE private.brilstash_listings SET approved_facts_revision = 1
WHERE installation_id = '30000000-0000-4000-8000-000000000003';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000003';
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000003';
DECLARE read_result jsonb := public.load_brilstash_catalogue_sources(installation);
DECLARE payload jsonb;
BEGIN
  IF NOT ((read_result->'rows') @> jsonb_build_array(jsonb_build_object(
    'externalId', 'paged-1', 'visible', true, 'inventory',
    CASE WHEN current_setting('fixture.on_demand_feed')::boolean THEN '{"kind":"on-demand","units":100}'::jsonb
      ELSE '{"kind":"quantity","units":1}'::jsonb END
  ))) THEN RAISE EXCEPTION 'inventory anchor hid a simple listing or changed its approved quantity'; END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'external_id', item->>'externalId', 'title', item->>'name',
    'product_url', 'https://shop.example.invalid/products/' || (item->>'slug') ||
      CASE WHEN item->>'kind' = 'offer' THEN '?offer_id=' || (item->>'id') || '&condition=used' ELSE '' END,
    'description', 'Condition: ' || CASE WHEN item->>'kind' = 'offer' THEN 'Used' ELSE 'New' END ||
      '. Specifications: Fixture specification. Box contents: Phone only. Warranty: 30 days.',
    'category', item->>'partnerCategory',
    'price_naira', item->'priceNaira', 'stock_quantity', item->'inventory'->'units',
    'images', CASE WHEN item->>'externalId' = 'paged-1' THEN
      '[{"url":"https://MEDIA.example.invalid.:443/approved"},{"url":"https://media.example.invalid/secondary"}]'::jsonb
      ELSE '[{"url":"https://MEDIA.example.invalid.:443/approved"}]'::jsonb END
  ) ORDER BY item->>'externalId') INTO payload
  FROM jsonb_array_elements(read_result->'rows') item;
  -- Compute the fixture digest outside the builder session.
  PERFORM set_config('fixture.paged_input', (read_result || jsonb_build_object('payload', payload))::text, true);
END $$;
RESET ROLE;
SELECT set_config('fixture.paged_digest', encode(sha256(convert_to(
  private.brilstash_canonical_json(current_setting('fixture.paged_input')::jsonb->'payload'), 'UTF8'
)), 'hex'), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE target uuid := '30000000-0000-4000-8000-000000000003';
DECLARE candidate uuid := '71000000-0000-4000-8000-000000000003';
DECLARE input jsonb := current_setting('fixture.paged_input')::jsonb;
DECLARE source_at timestamptz := LEAST((input->>'sourceReadAt')::timestamptz,
  ((statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date + time '22:00') AT TIME ZONE 'Africa/Lagos');
DECLARE first_images jsonb := input->'payload'->0->'images';
DECLARE tampered_images jsonb;
DECLARE tampered_payload jsonb;
BEGIN
  IF first_images IS DISTINCT FROM '[{"url":"https://MEDIA.example.invalid.:443/approved"},{"url":"https://media.example.invalid/secondary"}]'::jsonb
  THEN RAISE EXCEPTION 'fixture did not load verified images in priority order'; END IF;
  FOREACH tampered_images IN ARRAY ARRAY[
    jsonb_build_array(first_images->1, first_images->0), jsonb_build_array(first_images->0)
  ] LOOP
    tampered_payload := jsonb_set(input->'payload', '{0,images}', tampered_images);
    BEGIN
      PERFORM public.stage_brilstash_catalogue_snapshot(
        target, gen_random_uuid(), (input->>'catalogueRevision')::bigint, NULL,
        source_at, input->'rows', tampered_payload, fixture.brilstash_digest(tampered_payload)
      );
      RAISE EXCEPTION 'staging accepted a changed verified image sequence';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  PERFORM public.stage_brilstash_catalogue_snapshot(
    target, candidate, (input->>'catalogueRevision')::bigint, NULL,
    source_at,
    input->'rows', input->'payload', current_setting('fixture.paged_digest')
  );
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000002';
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000003';
DECLARE candidate uuid := '71000000-0000-4000-8000-000000000003';
DECLARE window_date date := (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date;
DECLARE approval uuid;
DECLARE evidence uuid;
BEGIN
  approval := public.approve_brilstash_candidate(installation, candidate, current_setting('fixture.paged_digest'));
  evidence := public.record_brilstash_fresh_installation(
    installation, 'fixture-paged', 'Local fresh fixture', false, false, 0, true
  );
  BEGIN
    PERFORM public.activate_first_brilstash_snapshot(installation, candidate, window_date, evidence, approval);
    RAISE EXCEPTION 'first activation accepted the missing drain policy';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.configure_brilstash_drain_policy(installation, 1200, 120, NULL, 'Fixture drain protocol');
  PERFORM set_config('fixture.paged_fresh_evidence', evidence::text, true);
END $$;
RESET ROLE;
UPDATE private.brilstash_fresh_installation_evidence
SET recorded_at = private.brilstash_clock() - interval '5 minutes'
WHERE id = current_setting('fixture.paged_fresh_evidence')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000003';
DECLARE candidate uuid := '71000000-0000-4000-8000-000000000003';
DECLARE approval uuid;
BEGIN
  approval := public.approve_brilstash_candidate(installation, candidate, current_setting('fixture.paged_digest'));
  PERFORM public.activate_first_brilstash_snapshot(installation, candidate,
    (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date,
    current_setting('fixture.paged_fresh_evidence')::uuid, approval);
  RAISE EXCEPTION 'first activation accepted expired fresh-installation evidence';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
RESET ROLE;
SAVEPOINT changed_display;
UPDATE public.products SET slug = 'renamed-after-staging' WHERE slug = 'paged-7';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000002';
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000003';
DECLARE candidate uuid := '71000000-0000-4000-8000-000000000003';
DECLARE approval uuid;
DECLARE evidence uuid;
BEGIN
  approval := public.approve_brilstash_candidate(installation, candidate, current_setting('fixture.paged_digest'));
  evidence := public.record_brilstash_fresh_installation(
    installation, 'fixture-paged', 'Local fresh fixture', false, false, 0, true
  );
  BEGIN
    PERFORM public.activate_first_brilstash_snapshot(
      installation, candidate, (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date, evidence, approval
    );
    RAISE EXCEPTION 'a candidate with a changed storefront slug was activated';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'BrilStash staged display data changed' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK TO SAVEPOINT changed_display;
RELEASE SAVEPOINT changed_display;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000002';
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000003';
DECLARE candidate uuid := '71000000-0000-4000-8000-000000000003';
DECLARE approval uuid;
DECLARE evidence uuid;
BEGIN
  approval := public.approve_brilstash_candidate(installation, candidate, current_setting('fixture.paged_digest'));
  evidence := public.record_brilstash_fresh_installation(
    installation, 'fixture-paged', 'Local fresh fixture', false, false, 0, true
  );
  BEGIN
    PERFORM set_config('fixture.expire_activation_after_update', 'yes', true);
    PERFORM set_config('fixture.activation_clock_step', 'first', true);
    PERFORM public.activate_first_brilstash_snapshot(
      installation, candidate, (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date, evidence, approval
    );
    RAISE EXCEPTION 'activation committed after evidence expired in the final display recheck';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'BrilStash activation window, evidence or freshness ended' THEN RAISE; END IF;
  END;
  IF public.activate_first_brilstash_snapshot(
    installation, candidate, (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date, evidence, approval
  ) IS DISTINCT FROM candidate THEN
    RAISE EXCEPTION 'seven-listing activation did not return the candidate';
  END IF;
  BEGIN
    PERFORM public.activate_first_brilstash_snapshot(
      installation, candidate, (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date, evidence, approval
    );
    RAISE EXCEPTION 'first activation repeated';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.rotate_brilstash_credential(
    installation, 0, encode(sha256(convert_to(repeat('p', 43), 'UTF8')), 'hex'), 0
  );
END $$;
RESET ROLE;
\if :brilstash_on_demand
SET LOCAL ROLE anon;
DO $$
DECLARE result jsonb := fixture.read_brilstash_page(repeat('p', 43), 1, 100, 250000);
BEGIN
  IF result->>'status' IS DISTINCT FROM 'ok' OR result->>'totalCount' IS DISTINCT FROM '7'
    OR result->>'totalPages' IS DISTINCT FROM '1'
    OR result->'products' IS DISTINCT FROM current_setting('fixture.paged_input')::jsonb->'payload'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(result->'products') item
      WHERE item->>'stock_quantity' IS DISTINCT FROM '100' OR (item->>'price_naira')::numeric < 250000)
  THEN RAISE EXCEPTION 'on-demand partner pull did not return seven complete 100-unit listings: %', result; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
DECLARE target uuid := '30000000-0000-4000-8000-000000000003';
DECLARE state jsonb := public.inspect_brilstash_probe_state(target);
DECLARE feed_url text := 'https://feed.example.invalid/partners/yield/brilpay/products?page=1&limit=100&min_price=';
BEGIN
  BEGIN
    PERFORM public.record_brilstash_handoff_probe(target, state, gen_random_uuid(), feed_url || '0');
    RAISE EXCEPTION 'on-demand handoff accepted a probe with the wrong price filter';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.record_brilstash_handoff_probe(target, state, gen_random_uuid(), feed_url || '250000');
END $$;
RESET ROLE;
\else
SET LOCAL ROLE anon;
DO $$
DECLARE combined jsonb := '[]'::jsonb;
DECLARE result jsonb;
BEGIN
  FOR page IN 1..3 LOOP
    result := fixture.read_brilstash_page(repeat('p', 43), page, 3, 0);
    IF result->>'status' IS DISTINCT FROM 'ok' OR result->>'totalCount' IS DISTINCT FROM '7'
      OR result->>'totalPages' IS DISTINCT FROM '3'
      OR jsonb_array_length(result->'products') IS DISTINCT FROM (CASE WHEN page = 3 THEN 1 ELSE 3 END)
    THEN RAISE EXCEPTION 'unexpected response on page %: %', page, result; END IF;
    combined := combined || (result->'products');
  END LOOP;
  IF combined IS DISTINCT FROM current_setting('fixture.paged_input')::jsonb->'payload'
    OR fixture.read_brilstash_page(repeat('p', 43), 1, 3, 400000)->>'totalCount' IS DISTINCT FROM '3'
    OR fixture.read_brilstash_page(repeat('p', 43), 1, 3, 400000)->'products'->0->>'price_naira'
      IS DISTINCT FROM '400000'
    OR fixture.read_brilstash_page(repeat('p', 43), 4, 3, 0)->'products' IS DISTINCT FROM '[]'::jsonb
  THEN RAISE EXCEPTION 'pagination did not preserve the payload or inclusive price filter'; END IF;
END $$;
RESET ROLE;
-- A single-page request must fail closed when the price floor would omit listings.
UPDATE private.brilstash_installations SET single_page_only = true
WHERE id = '30000000-0000-4000-8000-000000000003';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('p', 43), 1, 100, 250000)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'the financing floor silently returned a partial live generation'; END IF;
END $$;
RESET ROLE;
UPDATE private.brilstash_installations SET single_page_only = false
WHERE id = '30000000-0000-4000-8000-000000000003';
\ir paged-reader-live-eligibility.inc.sql
\endif
ROLLBACK TO SAVEPOINT paged_reader;
RELEASE SAVEPOINT paged_reader;
