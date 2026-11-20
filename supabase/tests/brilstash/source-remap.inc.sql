SAVEPOINT source_remap;
INSERT INTO public.product_variants (
  id, merchant_id, product_id, condition, attributes, is_inventory_anchor,
  price_override, stock_quantity, inventory_tracking_policy
)
SELECT '40000000-0000-4000-8000-000000000019', merchant_id, product_id, condition,
  attributes, is_inventory_anchor, price_override, stock_quantity, inventory_tracking_policy
FROM public.product_variants WHERE id = '40000000-0000-4000-8000-000000000011';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000002';
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000001';
DECLARE replacement uuid := '40000000-0000-4000-8000-000000000019';
DECLARE parent uuid := '40000000-0000-4000-8000-000000000001';
DECLARE prior uuid := '40000000-0000-4000-8000-000000000011';
DECLARE identity jsonb := '{"condition":"new","attributes":{"storage":"128GB"}}';
DECLARE revision bigint := (public.inspect_brilstash_installation(installation)->>'catalogueRevision')::bigint;
DECLARE approved jsonb;
BEGIN
  BEGIN
    PERFORM public.remap_brilstash_listing(installation, revision, 'fixture-one', 'variant',
      replacement, parent, '{"condition":"new","attributes":{"storage":"256GB"}}', 'Fixture identity proof');
    RAISE EXCEPTION 'repurposed listing was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.remap_brilstash_listing(installation, revision, 'fixture-one', 'variant',
    replacement, parent, identity, 'Fixture migration equivalence evidence');
  revision := (public.inspect_brilstash_installation(installation)->>'catalogueRevision')::bigint;
  approved := public.approve_brilstash_listing_facts(
    installation, revision, 'variant', replacement, parent, 1, identity,
    '128GB', 'Phone only', '30 days', 'Replacement source is reviewed'
  );
  IF approved->>'externalId' IS DISTINCT FROM 'fixture-one' OR approved->>'factsRevision' IS DISTINCT FROM '2'
  THEN RAISE EXCEPTION 'reviewed remap changed the external ID or cleared facts history'; END IF;

  revision := (public.inspect_brilstash_installation(installation)->>'catalogueRevision')::bigint;
  BEGIN
    PERFORM public.approve_brilstash_listing_facts(
      installation, revision, 'variant', prior, parent, 2, identity,
      '128GB', 'Phone only', '30 days', 'Duplicating the old source'
    );
    RAISE EXCEPTION 'old source received a duplicate external ID';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'old source generation still served after remap'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT source_remap;
RELEASE SAVEPOINT source_remap;
