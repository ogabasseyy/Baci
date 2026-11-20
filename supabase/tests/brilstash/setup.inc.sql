-- This suite qualifies a fresh binding for the same merchant after retirement.
UPDATE private.brilstash_installations SET admission = 'suspended', retired_at = now()
WHERE id = '30000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  merchant uuid := '20000000-0000-4000-8000-000000000001';
  product_id uuid := '40000000-0000-4000-8000-000000000001';
  variant_id uuid := '40000000-0000-4000-8000-000000000011';
  installation uuid;
  new_key uuid;
  prior_key uuid;
  listing jsonb;
BEGIN
  installation := public.bind_brilstash_installation(merchant, 'new-fixture', true);
  BEGIN
    PERFORM public.bind_brilstash_installation(merchant, 'another-fresh-fixture', true);
    RAISE EXCEPTION 'merchant acquired a second current installation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.bind_brilstash_installation(merchant, 'new-fixture', true);
    RAISE EXCEPTION 'partner binding was duplicated';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.bind_brilstash_installation('20000000-0000-4000-8000-000000000002', 'foreign', true);
    RAISE EXCEPTION 'operator bound a foreign merchant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.set_brilstash_builder(installation, '10000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'operator account was granted builder-only entitlement';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.set_brilstash_builder(installation, NULL);

  PERFORM public.set_brilstash_category_mapping(
    installation, 0, '50000000-0000-4000-8000-000000000001', 'Phones'
  );
  listing := public.approve_brilstash_listing_facts(
    installation, 1, 'variant', variant_id, product_id, 1,
    '{"condition":"new","attributes":{"storage":"128GB"}}', '128GB', 'Phone only', '30 days', 'Verified listing'
  );
  IF listing->>'externalId' IS NULL OR listing->>'factsRevision' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'listing approval did not assign a stable ID and facts revision';
  END IF;
  BEGIN
    PERFORM public.approve_brilstash_listing_facts(
      installation, 1, 'variant', variant_id, product_id, 1,
      '{"condition":"new","attributes":{"storage":"128GB"}}', '128GB', 'Phone only', '30 days', 'Stale approval'
    );
    RAISE EXCEPTION 'stale catalogue revision was accepted';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  prior_key := public.rotate_brilstash_credential(installation, 0,
    encode(sha256(convert_to(repeat('m', 43), 'UTF8')), 'hex'), 0);
  new_key := public.rotate_brilstash_credential(installation, 1,
    encode(sha256(convert_to(repeat('n', 43), 'UTF8')), 'hex'), 0);
  IF new_key IS NOT DISTINCT FROM prior_key THEN RAISE EXCEPTION 'credential did not rotate'; END IF;
  IF public.inspect_brilstash_installation(installation)->>'intendedCredentialId' IS DISTINCT FROM new_key::text
    OR public.inspect_brilstash_installation(installation)->>'credentialRevision' IS DISTINCT FROM '2'
  THEN RAISE EXCEPTION 'operator cannot inspect intended credential and revision'; END IF;
  PERFORM set_config('fixture.setup_installation', installation::text, true);
  PERFORM set_config('fixture.old_key', prior_key::text, true);
  PERFORM set_config('fixture.new_key', new_key::text, true);
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.brilstash_installations i
    JOIN private.brilstash_credentials prior ON prior.installation_id = i.id
    WHERE i.id = current_setting('fixture.setup_installation')::uuid AND i.credential_revision = 2
      AND i.intended_credential_id = current_setting('fixture.new_key')::uuid
      AND prior.id = current_setting('fixture.old_key')::uuid AND prior.revoked_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'rotation did not revoke the old key or bind the intended one'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE installation uuid := current_setting('fixture.setup_installation')::uuid;
DECLARE prior jsonb := public.inspect_brilstash_installation(installation);
BEGIN
  PERFORM public.retire_brilstash_installation(
    installation, (prior->>'catalogueRevision')::bigint, 'Wrong fresh installation binding'
  );
  IF public.inspect_brilstash_installation(installation)->>'retiredAt' IS NULL
    OR public.inspect_brilstash_installation(installation)->>'partnerIdentity' IS DISTINCT FROM 'new-fixture'
  THEN RAISE EXCEPTION 'retirement did not preserve the original identity'; END IF;
  BEGIN
    PERFORM public.bind_brilstash_installation((prior->>'merchantId')::uuid, 'new-fixture', true);
    RAISE EXCEPTION 'a retired partner identity was reused';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rotate_brilstash_credential(installation, 3, repeat('3', 64), 0);
    RAISE EXCEPTION 'a retired installation received a new credential';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('n', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unauthorized'
  THEN RAISE EXCEPTION 'retirement did not revoke the prior credential'; END IF;
END $$;
RESET ROLE;
