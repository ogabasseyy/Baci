-- Disposable database only; run via psql -v ON_ERROR_STOP=1.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
\ir ../migrations/20261119010141_brilstash_catalogue_storage.sql
\ir ../migrations/20261119010330_brilstash_catalogue_assortment.sql

INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO public.merchants VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO private.brilstash_installations (id, merchant_id, partner_identity)
VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'partner-one'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'partner-two');

DO $$
DECLARE
  installation uuid := '00000000-0000-4000-8000-000000000101';
  other_installation uuid := '00000000-0000-4000-8000-000000000102';
  operator_id uuid := '00000000-0000-4000-8000-000000000001';
  product_id uuid := '00000000-0000-4000-8000-000000000200';
  listing uuid;
  other_listing uuid;
  prior_revision bigint;
BEGIN
  BEGIN
    INSERT INTO private.brilstash_listings (
      installation_id, source_kind, source_id, parent_product_id,
      external_id, pilot_slot, reviewed_identity
    )
    VALUES (installation, 'product', product_id, product_id, 'unknown-condition', 1, '{"condition":null}');
    RAISE EXCEPTION 'null reviewed condition was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO private.brilstash_listings (
    installation_id, source_kind, source_id, parent_product_id,
    external_id, pilot_slot, reviewed_identity
  )
  VALUES (installation, 'product', product_id, product_id, 'listing-one', 1, '{"condition":"new"}')
  RETURNING id INTO listing;
  INSERT INTO private.brilstash_listings (
    installation_id, source_kind, source_id, parent_product_id,
    external_id, pilot_slot, reviewed_identity
  )
  VALUES (other_installation, 'product', product_id, product_id, 'other-listing', 1, '{"condition":"new"}')
  RETURNING id INTO other_listing;

  INSERT INTO private.brilstash_listing_facts (
    installation_id, listing_id, revision, specifications, box_contents, warranty,
    evidence_reference, reviewed_by
  )
  VALUES (other_installation, other_listing, 1, '128GB', 'Phone', '30 days', 'test evidence', operator_id);
  BEGIN
    UPDATE private.brilstash_listings
       SET approved_facts_revision = 1
     WHERE id = listing;
    RAISE EXCEPTION 'facts from another installation were accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  INSERT INTO private.brilstash_listing_facts (
    installation_id, listing_id, revision, specifications, box_contents, warranty,
    evidence_reference, reviewed_by
  )
  VALUES (installation, listing, 1, '128GB', 'Phone', '30 days', 'test evidence', operator_id);
  SELECT catalogue_revision INTO prior_revision FROM private.brilstash_installations WHERE id = installation;
  UPDATE private.brilstash_listings SET approved_facts_revision = 1 WHERE id = listing;
  IF (SELECT catalogue_revision FROM private.brilstash_installations WHERE id = installation) <> prior_revision + 1 THEN
    RAISE EXCEPTION 'activating reviewed facts must invalidate earlier candidates';
  END IF;
  BEGIN
    UPDATE private.brilstash_listing_facts SET warranty = 'changed' WHERE listing_id = listing AND revision = 1;
    RAISE EXCEPTION 'reviewed facts were changed in place';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO private.brilstash_listings (
    installation_id, source_kind, source_id, parent_product_id, external_id, pilot_slot, reviewed_identity
  )
  SELECT installation, 'variant', gen_random_uuid(), product_id, 'row-' || n, n, '{"condition":"new"}'
  FROM generate_series(2,7) n;
  BEGIN
    INSERT INTO private.brilstash_listings (
      installation_id, source_kind, source_id, parent_product_id, external_id, pilot_slot, reviewed_identity
    )
    VALUES (installation, 'offer', gen_random_uuid(), product_id, 'row-8', 8, '{"condition":"used"}');
    RAISE EXCEPTION 'eighth pilot listing was admitted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SELECT catalogue_revision INTO prior_revision FROM private.brilstash_installations WHERE id = installation;
  INSERT INTO private.brilstash_category_mappings (installation_id, merchant_category_id, partner_category)
  VALUES (installation, gen_random_uuid(), 'Fixture category');
  IF (SELECT catalogue_revision FROM private.brilstash_installations WHERE id = installation) <> prior_revision + 1 THEN
    RAISE EXCEPTION 'category change must invalidate earlier candidates';
  END IF;
  UPDATE private.brilstash_listings SET retired_at = now(), pilot_slot = NULL WHERE id = listing;
  BEGIN
    UPDATE private.brilstash_listings SET retired_at = NULL, pilot_slot = 1 WHERE id = listing;
    RAISE EXCEPTION 'retired listing was reactivated';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$$;
ROLLBACK;
