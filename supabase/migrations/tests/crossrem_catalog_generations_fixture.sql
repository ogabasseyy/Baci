-- Disposable database only. Run with psql -v ON_ERROR_STOP=1.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE TABLE public.merchants (
  id uuid PRIMARY KEY,
  business_name text,
  country text,
  gmc_variants_enabled boolean,
  payout_currency text,
  slug text,
  logo_url text,
  is_platform_admin boolean,
  is_published boolean
);
CREATE TABLE public.products (id uuid PRIMARY KEY, merchant_id uuid, category_id uuid);
CREATE TABLE public.product_variants (id uuid PRIMARY KEY, merchant_id uuid);
CREATE TABLE public.product_offers (id uuid PRIMARY KEY, merchant_id uuid);
CREATE TABLE public.product_feed_images (
  id uuid PRIMARY KEY,
  merchant_id uuid,
  product_id uuid,
  variant_id uuid,
  source_url text,
  verified_url text,
  verified_format text,
  status text,
  is_primary boolean,
  position integer,
  last_checked_at timestamptz,
  failure_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  verified_at timestamptz,
  fixture_future_column text
);
CREATE TABLE public.categories (id uuid PRIMARY KEY, merchant_id uuid, name text);
CREATE TABLE public.domains (id uuid PRIMARY KEY, merchant_id uuid);
CREATE TABLE public.product_categories (product_id uuid, category_id uuid);
CREATE TABLE public.product_key_specs (product_id uuid PRIMARY KEY);

GRANT SELECT ON public.merchants TO anon, authenticated;
INSERT INTO public.merchants (id, is_published) VALUES
  ('6b5cb8a4-5575-456c-b936-8cdfae30db74', true),
  ('00000000-0000-4000-8000-000000000001', true);

\ir ../20261119162000_crossrem_catalog_generations.sql
\ir ../20261119163500_crossrem_image_revision_heartbeat.sql
\ir ../20261119165000_crossrem_image_audit_fields.sql

SET ROLE anon;
DO $$ BEGIN
  IF (SELECT revision FROM public.crossrem_catalog_generations) IS NULL
     OR has_column_privilege('public.crossrem_catalog_generations', 'revision', 'UPDATE') THEN
    RAISE EXCEPTION 'Published revision must be readable and read-only';
  END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
  pilot constant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  other constant uuid := '00000000-0000-4000-8000-000000000001';
  item constant uuid := '00000000-0000-4000-8000-000000000002';
  category constant uuid := '00000000-0000-4000-8000-000000000003';
  revision_before uuid;
  revision_after uuid;
  mutation text;
BEGIN
  SELECT revision INTO STRICT revision_before FROM public.crossrem_catalog_generations;
  INSERT INTO public.products (id, merchant_id) VALUES (other, other);
  INSERT INTO public.categories (id, merchant_id) VALUES (category, other);
  IF (SELECT revision FROM public.crossrem_catalog_generations) <> revision_before THEN
    RAISE EXCEPTION 'Unrelated merchants must leave the pilot revision unchanged';
  END IF;

  FOREACH mutation IN ARRAY ARRAY[
    format('INSERT INTO public.products VALUES (%L, %L, %L)', item, pilot, category),
    format('UPDATE public.categories SET name = %L WHERE id = %L', 'New category label', category),
    format('INSERT INTO public.product_variants VALUES (%L, %L)', item, pilot),
    format('INSERT INTO public.product_offers VALUES (%L, %L)', item, pilot),
    format('INSERT INTO public.product_feed_images (id, merchant_id, product_id, status) VALUES (%L, %L, %L, %L)', item, pilot, item, 'verified'),
    format('UPDATE public.product_feed_images SET status = %L WHERE id = %L', 'stale', item),
    format('UPDATE public.product_feed_images SET fixture_future_column = %L WHERE id = %L', 'fixture change', item),
    format('INSERT INTO public.domains VALUES (%L, %L)', item, pilot),
    format('INSERT INTO public.product_categories VALUES (%L, %L)', item, category),
    format('INSERT INTO public.product_key_specs VALUES (%L)', item),
    format('UPDATE public.merchants SET slug = %L WHERE id = %L', 'updated-fixture-slug', pilot),
    format('DELETE FROM public.product_key_specs WHERE product_id = %L', item),
    format('UPDATE public.product_variants SET merchant_id = %L WHERE id = %L', other, item)
  ] LOOP
    EXECUTE mutation;
    SELECT revision INTO STRICT revision_after FROM public.crossrem_catalog_generations;
    IF revision_after = revision_before THEN
      RAISE EXCEPTION 'Missing revision change for %', mutation;
    END IF;
    revision_before := revision_after;
  END LOOP;

  UPDATE public.product_feed_images
  SET last_checked_at = now(), updated_at = now(), verified_at = now(),
      created_at = now(), failure_reason = 'fixture reason'
  WHERE id = item;
  IF (SELECT revision FROM public.crossrem_catalog_generations) <> revision_before THEN
    RAISE EXCEPTION 'Image verification heartbeats must preserve the revision';
  END IF;

  BEGIN
    DELETE FROM public.products WHERE id = item;
    IF (SELECT revision FROM public.crossrem_catalog_generations) = revision_before THEN
      RAISE EXCEPTION 'Deleting a product must change the revision';
    END IF;
    RAISE SQLSTATE 'Z0001';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN
    NULL;
  END;
  IF (SELECT revision FROM public.crossrem_catalog_generations) <> revision_before THEN
    RAISE EXCEPTION 'A rolled-back catalog mutation must preserve the revision';
  END IF;

  TRUNCATE public.product_feed_images;
  IF (SELECT revision FROM public.crossrem_catalog_generations) = revision_before THEN
    RAISE EXCEPTION 'Truncating the manifest must change the revision';
  END IF;
  UPDATE public.merchants SET is_published = false WHERE id = pilot;
END
$$;

SET ROLE anon;
DO $$ BEGIN
  IF EXISTS (SELECT revision FROM public.crossrem_catalog_generations) THEN
    RAISE EXCEPTION 'Anonymous callers must not read an unpublished revision';
  END IF;
END $$;
RESET ROLE;

-- Row-scoped deletes represent merchant-level maintenance. Whole-table
-- truncation removes shared data for all enrolled merchants.
INSERT INTO public.crossrem_catalog_generations (merchant_id)
VALUES ('00000000-0000-4000-8000-000000000001');
CREATE TEMP TABLE previous_revisions AS
SELECT merchant_id, revision FROM public.crossrem_catalog_generations;
TRUNCATE public.product_feed_images;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.crossrem_catalog_generations
    JOIN previous_revisions USING (merchant_id, revision)
  ) OR (SELECT count(*) FROM public.crossrem_catalog_generations) <> 2 THEN
    RAISE EXCEPTION 'Global source truncation must change each enrolled revision';
  END IF;
END $$;

TRUNCATE public.merchants CASCADE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.crossrem_catalog_generations) THEN
    RAISE EXCEPTION 'Merchant truncation must clear all enrollments';
  END IF;
END $$;
