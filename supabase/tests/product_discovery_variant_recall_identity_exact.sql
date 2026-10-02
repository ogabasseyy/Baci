-- Matcher-exact identity: retrieval keys and recall ranking must agree with
-- the final matcher bit for bit. Coarse NFKC keys folded separators the
-- matcher distinguishes ('A B' vs 'A-B'), so collisions filled capped
-- windows ahead of the true match; brand/model/compat now digest the
-- matcher normalization on both sides.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000211',
  'exact-test@example.test',
  'Exact Test Merchant',
  'exact-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, category, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000661', 'cb58d110-0000-4000-8000-000000000211',
   'Hyphen model', 'hyphen-model', 'Acme', 'Smartphones', 50000, 'active', true, true, 'off',
   '{"product_type":"phone","model":"A-B"}'),
  ('cb58d110-0000-4000-8000-000000000662', 'cb58d110-0000-4000-8000-000000000211',
   'Spaced model', 'spaced-model', 'Acme', 'Smartphones', 50000, 'active', true, true, 'off',
   '{"product_type":"phone","model":"A B"}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000671', 'cb58d110-0000-4000-8000-000000000661',
   'cb58d110-0000-4000-8000-000000000211', '{"storage_gb":256}', 5),
  ('cb58d110-0000-4000-8000-000000000672', 'cb58d110-0000-4000-8000-000000000662',
   'cb58d110-0000-4000-8000-000000000211', '{"storage_gb":256}', 5);

DO $$
BEGIN
  IF discovery.discovery_identity_matcher_normalize('  A-B ') IS DISTINCT FROM 'a-b' THEN
    RAISE EXCEPTION 'matcher normalization diverged from the final matcher';
  END IF;
  IF discovery.discovery_identity_lexeme('model', 'A B') IS NOT DISTINCT FROM
     discovery.discovery_identity_lexeme('model', 'A-B') THEN
    RAISE EXCEPTION 'model lexemes collided across a separator the matcher keeps';
  END IF;
  IF discovery.discovery_identity_lexeme('model', 'A B') IS DISTINCT FROM
     'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
       'model' || pg_catalog.chr(31) || 'a b', 'UTF8'), 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'model lexeme diverged from the tag plus matcher-normalized digest';
  END IF;
  IF discovery.discovery_identity_matcher_normalize('ΟΣ') IS DISTINCT FROM 'ΟΣ' THEN
    RAISE EXCEPTION 'matcher normalization must fold ASCII only, matching toAsciiLowerCase';
  END IF;
  IF discovery.discovery_identity_lexeme('brand', 'ΟΣ') IS DISTINCT FROM
     'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
       'brand' || pg_catalog.chr(31) || 'ΟΣ', 'UTF8'), 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'brand lexeme diverged from the ASCII-folded digest';
  END IF;
END;
$$;

-- Exercise the recall RPC as its public storefront caller, under publication RLS.
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  recall_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  SELECT array_agg(product_id ORDER BY rank) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000211',
    '[{"key":"storage_gb","operator":"eq","value":256,"branch":0}]'::jsonb,
    10,
    0,
    '[{"branch":0,"model":"A B"}]'::jsonb
  ) WITH ORDINALITY AS ranked(product_id, attributes, rank);
  IF recall_ids IS DISTINCT FROM ARRAY[
    'cb58d110-0000-4000-8000-000000000662'::uuid,
    'cb58d110-0000-4000-8000-000000000661'::uuid
  ] THEN
    RAISE EXCEPTION 'separator-colliding models must sink below the exact match, got %', recall_ids;
  END IF;
END;
$$;
ROLLBACK;
