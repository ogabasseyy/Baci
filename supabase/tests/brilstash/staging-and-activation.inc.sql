-- Remove the deliberately ineligible approval so staging can succeed.
DO $$
BEGIN
  IF private.brilstash_storefront_slug_segment('caf%C3%A9%2Bphone')
      IS DISTINCT FROM 'caf%C3%A9%2Bphone'
    OR private.brilstash_storefront_slug_segment('café+phone') IS DISTINCT FROM 'caf%C3%A9%2Bphone'
    OR private.brilstash_storefront_slug_segment('%2e%2e') IS NOT NULL
    OR private.brilstash_storefront_slug_segment('two%2Fsegments') IS NOT NULL
  THEN RAISE EXCEPTION 'BrilStash storefront slug serialization diverged'; END IF;
  IF private.brilstash_payload_has_wire_shape(
    '[{"external_id":"invalid-url","product_url":"https://","title":"Phone","description":"Phone","category":"Phones","price_naira":365000,"stock_quantity":0,"images":[{"url":"https://media.example.invalid/approved"}]}]'::jsonb
  ) THEN RAISE EXCEPTION 'scheme without a host was accepted'; END IF;
  IF private.brilstash_payload_has_wire_shape(
    '[{"external_id":"invalid-port","product_url":"https://shop.example.invalid:65536/phone","title":"Phone","description":"Phone","category":"Phones","price_naira":365000,"stock_quantity":0,"images":[{"url":"https://media.example.invalid/approved"}]}]'::jsonb
  ) THEN RAISE EXCEPTION 'out-of-range product URL port was accepted'; END IF;
  IF private.brilstash_image_url_key('https://CDN.example.invalid:00443?width=42')
      IS DISTINCT FROM 'https://cdn.example.invalid/?width=42'
    OR private.brilstash_image_url_key('https://CDN.example.invalid:8443/file.jpg')
      IS DISTINCT FROM 'https://cdn.example.invalid:8443/file.jpg'
    OR private.brilstash_image_url_key('https://cdn.example.invalid:0/image.jpg') IS NOT NULL
    OR private.brilstash_image_url_key('https://cdn.example.invalid:65536/image.jpg') IS NOT NULL
    OR private.brilstash_image_url_key('https://user@cdn.example.invalid/image.jpg') IS NOT NULL
    OR private.brilstash_image_url_key('https://cdn.example.invalid/image.jpg#crop') IS NOT NULL
    OR private.brilstash_image_url_key('https://-cdn.example.invalid/image.jpg') IS NOT NULL
    OR private.brilstash_expected_verified_images(
      '["https://cdn.example.invalid/image.jpg","https://cdn.example.invalid:65536/image.jpg"]'
    ) IS NOT NULL
  THEN RAISE EXCEPTION 'BrilStash staging image URL authority diverged'; END IF;
END $$;
UPDATE private.brilstash_listings SET retired_at = now(), pilot_slot = NULL
WHERE external_id = 'wrong-tenant';
SELECT set_config('fixture.wrong_image_digest', encode(sha256(convert_to(
  private.brilstash_canonical_json(
    '[{"external_id":"fixture-one","product_url":"https://shop.example.invalid/products/fixture-phone?variantId=40000000-0000-4000-8000-000000000011&condition=new","title":"Fixture phone","description":"Condition: New. Specifications: 128GB. Box contents: Phone only. Warranty: 30 days.","category":"Phones","price_naira":365000,"stock_quantity":0,"images":[{"url":"https://media.example.invalid/wrong-condition"}]}]'::jsonb
  ), 'UTF8'
)), 'hex'), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  installation uuid := '30000000-0000-4000-8000-000000000001';
  candidate uuid := '70000000-0000-4000-8000-000000000001';
  read_result jsonb := public.load_brilstash_catalogue_sources(installation);
  source_time timestamptz := LEAST((read_result->>'sourceReadAt')::timestamptz,
    ((statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date + time '22:00') AT TIME ZONE 'Africa/Lagos');
  payload jsonb := '[{"external_id":"fixture-one","product_url":"https://shop.example.invalid/products/fixture-phone?variantId=40000000-0000-4000-8000-000000000011&condition=new","title":"Fixture phone","description":"Condition: New. Specifications: 128GB. Box contents: Phone only. Warranty: 30 days.","category":"Phones","price_naira":365000,"stock_quantity":0,"images":[{"url":"https://media.example.invalid/approved"}]}]';
  forged jsonb;
  field record;
  digest text := '13ea9aa70df68497c794f66598d55c82db152b709139363889d492109b69ff73';
BEGIN
  IF public.stage_brilstash_catalogue_snapshot(
    installation, candidate, (read_result->>'catalogueRevision')::bigint, NULL,
    source_time, read_result->'rows', payload, digest
  ) IS DISTINCT FROM candidate THEN
    RAISE EXCEPTION 'staging did not return the candidate ID';
  END IF;
  IF public.stage_brilstash_catalogue_snapshot(
    installation, candidate, (read_result->>'catalogueRevision')::bigint, NULL,
    source_time, read_result->'rows', payload, digest
  ) IS DISTINCT FROM candidate THEN
    RAISE EXCEPTION 'identical staging retry did not return the recorded candidate';
  END IF;
  FOR field IN SELECT key, value FROM jsonb_each('{
    "title":"Unreviewed title",
    "description":"Unreviewed warranty",
    "brand":"Unreviewed brand",
    "model_number":"Unreviewed model",
    "product_url":"https://unrelated.example.invalid/products/fixture-phone?variantId=40000000-0000-4000-8000-000000000011&condition=new"
  }'::jsonb) LOOP
    forged := jsonb_set(payload, ARRAY['0', field.key], field.value);
    BEGIN
      PERFORM public.stage_brilstash_catalogue_snapshot(
        installation, gen_random_uuid(), (read_result->>'catalogueRevision')::bigint, NULL,
        source_time, read_result->'rows', forged,
        fixture.brilstash_digest(forged)
      );
      RAISE EXCEPTION 'staging accepted unapproved display field %', field.key;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  FOREACH forged IN ARRAY ARRAY[
    jsonb_set(payload, '{0,product_url}', to_jsonb(replace(payload->0->>'product_url', 'fixture-phone', 'wrong-listing'))),
    jsonb_set(payload, '{0,product_url}', to_jsonb(replace(payload->0->>'product_url', 'condition=new', 'condition=used'))),
    jsonb_set(payload, '{0,product_url}', to_jsonb(replace(payload->0->>'product_url', 'shop.example.invalid', 'other.example.invalid')))
  ] LOOP
    BEGIN
      PERFORM public.stage_brilstash_catalogue_snapshot(
        installation, gen_random_uuid(), (read_result->>'catalogueRevision')::bigint, NULL,
        source_time, read_result->'rows', forged, fixture.brilstash_digest(forged)
      );
      RAISE EXCEPTION 'staging accepted an unapproved URL path, selection, or foreign merchant domain';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM public.stage_brilstash_catalogue_snapshot(
      installation, gen_random_uuid(), (read_result->>'catalogueRevision')::bigint, NULL,
      source_time, read_result->'rows', jsonb_set(payload, '{0,images,0,url}', '"https://media.example.invalid/wrong-condition"'),
      current_setting('fixture.wrong_image_digest')
    );
    RAISE EXCEPTION 'unverified listing image was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.stage_brilstash_catalogue_snapshot(
      installation, gen_random_uuid(), (read_result->>'catalogueRevision')::bigint, NULL,
      source_time, read_result->'rows', payload, repeat('a', 64)
    );
    RAISE EXCEPTION 'incorrect payload digest accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.stage_brilstash_catalogue_snapshot(
      installation, gen_random_uuid(), (read_result->>'catalogueRevision')::bigint, NULL,
      source_time, read_result->'rows',
      jsonb_set(payload, '{0,internal}', '"must-not-be-exported"'), '938af001172a195a7095a4b553efd08f045a47c0fb71407a3315c3e5327e0dbc'
    );
    RAISE EXCEPTION 'extra payload field was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.stage_brilstash_catalogue_snapshot(
      installation, gen_random_uuid(), (read_result->>'catalogueRevision')::bigint, NULL,
      source_time, '[]'::jsonb, payload, digest
    );
    RAISE EXCEPTION 'changed source read accepted';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.brilstash_generations
    WHERE id = '70000000-0000-4000-8000-000000000001'
      AND source_manifest->0->>'externalId' = 'fixture-one'
  ) OR EXISTS (
    SELECT 1 FROM private.brilstash_installations WHERE active_generation_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'staging did not retain identity or changed serving'; END IF;
END $$;
DO $$
BEGIN
  IF private.brilstash_promotion_window_allows('2026-11-19', '2026-11-18 23:15:00+01')
    OR private.brilstash_promotion_window_allows('2026-11-19', '2026-11-19 00:15:00+01')
    OR private.brilstash_promotion_window_allows('2026-11-19', '2026-11-19 23:30:00+01')
    OR NOT private.brilstash_promotion_window_allows('2026-11-19', '2026-11-19 22:15:00+01')
  THEN RAISE EXCEPTION 'invalid dated promotion window'; END IF;
END $$;

-- Freeze only the fixture clock to exercise activation without wall-clock dependencies.
CREATE OR REPLACE FUNCTION private.brilstash_clock()
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE base_time timestamptz := ((statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date + time '22:15:00') AT TIME ZONE 'Africa/Lagos';
BEGIN
  IF current_setting('fixture.activation_clock_step', true) = 'first' THEN
    PERFORM set_config('fixture.activation_clock_step', 'second', true);
  ELSIF current_setting('fixture.activation_clock_step', true) = 'second' THEN
    IF current_setting('fixture.expire_activation_after_update', true) IS DISTINCT FROM 'yes' THEN
      RETURN base_time + interval '5 minutes';
    END IF;
    PERFORM set_config('fixture.activation_clock_step', 'third', true);
  ELSIF current_setting('fixture.activation_clock_step', true) = 'third' THEN
    RETURN base_time + interval '5 minutes';
  END IF;
  RETURN base_time;
END $$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.approve_brilstash_candidate(
    '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', repeat('a', 64)
  );
  RAISE EXCEPTION 'builder was allowed to approve a candidate';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SELECT set_config('fixture.candidate_digest', payload_digest, true) FROM private.brilstash_generations
WHERE id = '70000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000002';
SELECT public.configure_brilstash_drain_policy(
  '30000000-0000-4000-8000-000000000001', 1200, 120, NULL, 'Fixture drain protocol'
);
DO $$
DECLARE
  installation uuid := '30000000-0000-4000-8000-000000000001';
  candidate uuid := '70000000-0000-4000-8000-000000000001';
  window_date date := (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date;
  approval uuid;
  evidence uuid;
BEGIN
  BEGIN
    PERFORM public.approve_brilstash_candidate(installation, candidate, repeat('a', 64));
    RAISE EXCEPTION 'wrong candidate digest was approved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  approval := public.approve_brilstash_candidate(installation, candidate, current_setting('fixture.candidate_digest'));
  BEGIN
    PERFORM public.record_brilstash_fresh_installation(
      installation, 'fixture-two', 'partner proof', false, false, 0, true
    );
    RAISE EXCEPTION 'evidence from wrong installation was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  evidence := public.record_brilstash_fresh_installation(
    installation, 'fixture-one', 'partner proof', false, false, 0, true
  );
  BEGIN
    PERFORM set_config('fixture.activation_clock_step', 'first', true);
    PERFORM public.activate_first_brilstash_snapshot(installation, candidate, window_date, evidence, approval);
    RAISE EXCEPTION 'activation opened after the installation evidence expired';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'BrilStash activation window, evidence or freshness ended' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.activate_first_brilstash_snapshot(installation, candidate, window_date, evidence, approval);
    RAISE EXCEPTION 'first activation accepted a single listing';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'BrilStash first activation requires seven listings' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.brilstash_first_activations)
    OR EXISTS (
      SELECT 1 FROM private.brilstash_installations
      WHERE admission = 'open' OR active_generation_id IS NOT NULL
    )
  THEN RAISE EXCEPTION 'rejected first activation changed serving state'; END IF;
END $$;

-- The remaining single-listing suites model an already serving, reduced
-- assortment. The seven-listing activation is exercised in paged-reader.
UPDATE private.brilstash_installations
SET active_generation_id = '70000000-0000-4000-8000-000000000001',
  activated_at = private.brilstash_clock(), admission = 'open', serving_revision = serving_revision + 1
WHERE id = '30000000-0000-4000-8000-000000000001';
