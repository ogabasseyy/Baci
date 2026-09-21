-- Run after 20260921180000_get_santa_catalog.sql.
BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_published_merchant uuid := '2a9a0000-0000-4000-8000-000000000001';
  v_unpublished_merchant uuid := '2a9a0000-0000-4000-8000-000000000002';
  v_other_merchant uuid := '2a9a0000-0000-4000-8000-000000000003';
  v_result record;
  v_definition text;
BEGIN
  IF pg_catalog.to_regprocedure('public.get_santa_catalog(uuid)') IS NULL THEN
    RAISE EXCEPTION 'get_santa_catalog(uuid) is missing';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'anon', 'public.get_santa_catalog(uuid)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.get_santa_catalog(uuid)', 'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) AS privilege
    WHERE p.oid = 'public.get_santa_catalog(uuid)'::regprocedure
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Santa catalog function grants are not narrowly explicit';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.get_santa_catalog(uuid)'::regprocedure)
  INTO v_definition;
  IF v_definition NOT LIKE '%SECURITY DEFINER%'
    OR v_definition NOT LIKE '%SET search_path TO ''''%'
    OR v_definition LIKE '%RETURNS TABLE (name text, price numeric, cost_price%'
  THEN
    RAISE EXCEPTION 'Santa catalog function security/projection contract regressed';
  END IF;

  INSERT INTO public.merchants (id, email, business_name, slug, is_published)
  VALUES
    (v_published_merchant, 'santa-public@example.test', 'Santa Public', 'santa-public', true),
    (v_unpublished_merchant, 'santa-hidden@example.test', 'Santa Hidden', 'santa-hidden', false),
    (v_other_merchant, 'santa-other@example.test', 'Santa Other', 'santa-other', true);

  INSERT INTO public.products (id, merchant_id, name, price, cost_price, status, brand)
  VALUES
    ('2a9a0000-0000-4000-8000-000000000011', v_published_merchant, 'High margin device', 100000, 40000, 'active', 'Apple'),
    ('2a9a0000-0000-4000-8000-000000000012', v_published_merchant, 'Margin-protected device', 100000, 95000, 'active', 'Apple'),
    ('2a9a0000-0000-4000-8000-000000000013', v_published_merchant, 'No-cost device', 100000, NULL, 'active', 'Apple'),
    ('2a9a0000-0000-4000-8000-000000000014', v_published_merchant, 'Zero-price device', 0, NULL, 'active', 'Apple'),
    ('2a9a0000-0000-4000-8000-000000000016', v_published_merchant, 'Galaxy A55', 100000, 40000, 'active', 'Samsung'),
    ('2a9a0000-0000-4000-8000-000000000017', v_published_merchant, 'Budget device', 100000, 0, 'active', 'Tecno'),
    ('2a9a0000-0000-4000-8000-000000000015', v_published_merchant, 'Inactive device', 100000, 0, 'draft', 'Apple'),
    ('2a9a0000-0000-4000-8000-000000000021', v_unpublished_merchant, 'Hidden device', 100000, 0, 'active', 'Apple'),
    ('2a9a0000-0000-4000-8000-000000000031', v_other_merchant, 'Other device', 100000, 0, 'active', 'Apple');

  SELECT * INTO v_result
  FROM public.get_santa_catalog(v_published_merchant)
  WHERE name = 'High margin device';
  IF v_result.price IS DISTINCT FROM 100000::numeric
    OR v_result.max_margin_discount_percentage IS DISTINCT FROM 2
  THEN
    RAISE EXCEPTION 'high-margin catalog projection was unexpected: %', row_to_json(v_result);
  END IF;

  SELECT * INTO v_result
  FROM public.get_santa_catalog(v_published_merchant)
  WHERE name = 'Margin-protected device';
  IF v_result.max_margin_discount_percentage IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'margin floor did not protect high-cost product: %', row_to_json(v_result);
  END IF;

  SELECT * INTO v_result
  FROM public.get_santa_catalog(v_published_merchant)
  WHERE name = 'No-cost device';
  IF v_result.max_margin_discount_percentage IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'checkout-compatible flexible-price ceiling was not preserved: %', row_to_json(v_result);
  END IF;

  SELECT * INTO v_result
  FROM public.get_santa_catalog(v_published_merchant)
  WHERE name = 'Zero-price device';
  IF v_result.max_margin_discount_percentage IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'invalid/zero price must fail closed: %', row_to_json(v_result);
  END IF;



  IF EXISTS (
    SELECT 1 FROM public.get_santa_catalog(v_published_merchant)
    WHERE name = 'Inactive device'
  ) OR EXISTS (
    SELECT 1 FROM public.get_santa_catalog(v_unpublished_merchant)
  ) OR EXISTS (
    SELECT 1 FROM public.get_santa_catalog(v_other_merchant)
    WHERE name = 'High margin device'
  ) THEN
    RAISE EXCEPTION 'Santa projection publication or tenant isolation regressed';
  END IF;
END;
$$;

-- Exercise the real function as its anonymous consumer role; SECURITY DEFINER
-- can read the safe projection but not return a cost column.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
DO $$
DECLARE
  v_names text[];
BEGIN
  SELECT array_agg(name ORDER BY name) INTO v_names
  FROM public.get_santa_catalog('2a9a0000-0000-4000-8000-000000000001');
  IF v_names IS DISTINCT FROM ARRAY[
    'Budget device', 'Galaxy A55', 'High margin device', 'Margin-protected device', 'No-cost device', 'Zero-price device'
  ]::text[] THEN
    RAISE EXCEPTION 'anon safe projection returned unexpected rows: %', v_names;
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
