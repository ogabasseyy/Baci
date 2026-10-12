-- Runtime regression contract for 20260731190000_atomic_blog_post_product_links.sql.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--   supabase/migrations/tests/atomic_blog_post_product_links.sql

BEGIN;

CREATE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END;
$$;

CREATE FUNCTION public.test_assert_atomic_blog_error(
  p_post_id uuid, p_merchant_id uuid, p_payload jsonb, p_product_ids uuid[],
  p_expected_state text, p_expected_message text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE
      'SELECT id FROM public.mutate_merchant_blog_post_with_product_links($1, $2, $3, $4)'
      USING p_post_id, p_merchant_id, p_payload, p_product_ids;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_expected_state AND SQLERRM = p_expected_message THEN
      RETURN;
    END IF;
    RAISE EXCEPTION
      'unexpected atomic blog error: expected [%] %, received [%] %',
      p_expected_state, p_expected_message, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'atomic blog product-link RPC unexpectedly succeeded: %', p_expected_message;
END;
$$;

CREATE FUNCTION public.test_atomic_blog_link_insert_failure()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'forced_blog_link_insert_failure';
END;
$$;

CREATE FUNCTION public.test_assert_atomic_blog_media_error(
  p_post_id uuid, p_merchant_id uuid, p_payload jsonb, p_media_paths text[],
  p_expected_state text, p_expected_prefix text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM id FROM public.mutate_merchant_blog_post_with_product_links(
      p_post_id, p_merchant_id, p_payload, NULL, p_media_paths);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_expected_state AND SQLERRM LIKE p_expected_prefix || '%' THEN
      RETURN;
    END IF;
    RAISE EXCEPTION
      'unexpected atomic blog media error: expected [%] %, received [%] %',
      p_expected_state, p_expected_prefix, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'atomic blog media verify unexpectedly succeeded: %', p_expected_prefix;
END;
$$;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure,
      LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS acl_entry
    WHERE procedure.oid = 'public.mutate_merchant_blog_post_with_product_links(uuid,uuid,jsonb,uuid[],text[])'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
  AND NOT has_function_privilege('anon',
    'public.mutate_merchant_blog_post_with_product_links(uuid,uuid,jsonb,uuid[],text[])', 'EXECUTE')
  AND NOT has_function_privilege('service_role',
    'public.mutate_merchant_blog_post_with_product_links(uuid,uuid,jsonb,uuid[],text[])', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.mutate_merchant_blog_post_with_product_links(uuid,uuid,jsonb,uuid[],text[])', 'EXECUTE'),
  'atomic blog product-link RPC grants are incorrect'
);

CREATE TEMP TABLE pg_temp.atomic_blog_product_ids (product_id uuid PRIMARY KEY);
INSERT INTO pg_temp.atomic_blog_product_ids
SELECT gen_random_uuid() FROM generate_series(1, 21);
SELECT array_agg(product_id ORDER BY product_id) AS product_ids
FROM pg_temp.atomic_blog_product_ids \gset
SELECT product_id::text AS first_product_id
FROM pg_temp.atomic_blog_product_ids
ORDER BY product_id
LIMIT 1 \gset
SELECT array_agg(product_id ORDER BY product_id DESC) AS ordered_product_ids
FROM (
  SELECT product_id
  FROM pg_temp.atomic_blog_product_ids
  ORDER BY product_id
  LIMIT 2
) AS ordered_product_ids \gset

ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('01ac0000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'atomic-blog-owner@example.com', 'test', now(), now(), now(), '{}', '{}'),
  ('01ac0000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'atomic-blog-other@example.com', 'test', now(), now(), now(), '{}', '{}'),
  ('01ac0000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'atomic-blog-staff@example.com', 'test', now(), now(), now(), '{}', '{}');
INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES
  ('01ac0000-0000-4000-8000-000000000001', '01ac0000-0000-4000-8000-000000000003',
    'atomic-blog-merchant@example.com', 'Atomic Blog', 'atomic-blog'),
  ('01ac0000-0000-4000-8000-000000000002', '01ac0000-0000-4000-8000-000000000004',
    'atomic-blog-other-merchant@example.com', 'Other Atomic Blog', 'other-atomic-blog');
ALTER TABLE public.merchants ENABLE TRIGGER USER;

ALTER TABLE public.staff_members DISABLE TRIGGER USER;
INSERT INTO public.staff_members (merchant_id, user_id, email, name, role, permissions, status)
VALUES ('01ac0000-0000-4000-8000-000000000001', '01ac0000-0000-4000-8000-000000000005',
  'atomic-blog-staff@example.com', 'Atomic Staff', 'sales_rep', '{"marketing":{"create":true}}', 'active');
ALTER TABLE public.staff_members ENABLE TRIGGER USER;

ALTER TABLE public.products DISABLE TRIGGER USER;
INSERT INTO public.products (id, merchant_id, name, price, manage_stock, status)
SELECT product_id, '01ac0000-0000-4000-8000-000000000001', 'Atomic product', 1, false, 'active'
FROM pg_temp.atomic_blog_product_ids;
INSERT INTO public.products (id, merchant_id, name, price, manage_stock, status)
VALUES ('01ac0000-0000-4000-8000-000000000007', '01ac0000-0000-4000-8000-000000000002',
  'Foreign product', 1, false, 'active');
ALTER TABLE public.products ENABLE TRIGGER USER;

ALTER TABLE public.blog_posts DISABLE TRIGGER USER;
INSERT INTO public.blog_posts (id, merchant_id, title, slug, content, author_name)
VALUES ('01ac0000-0000-4000-8000-000000000006', '01ac0000-0000-4000-8000-000000000002',
  'Foreign post', 'foreign-post', 'Foreign', 'Other owner');
ALTER TABLE public.blog_posts ENABLE TRIGGER USER;

GRANT EXECUTE ON FUNCTION public.test_assert_atomic_blog_error(uuid, uuid, jsonb, uuid[], text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.test_assert_atomic_blog_media_error(uuid, uuid, jsonb, text[], text, text)
  TO authenticated;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '01ac0000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;
SELECT id AS post_id FROM public.mutate_merchant_blog_post_with_product_links(
  NULL, '01ac0000-0000-4000-8000-000000000001',
  '{"title":"Initial","slug":"atomic-post","content":"Initial","author_name":"Staff"}'::jsonb,
  ARRAY[:'first_product_id'::uuid]) \gset
SELECT public.test_assert_atomic_blog_error(:'post_id'::uuid, '01ac0000-0000-4000-8000-000000000001',
  '{"title":"Denied"}'::jsonb, NULL, '42501', 'merchant_marketing_edit_permission_required');
RESET ROLE;

UPDATE public.staff_members SET permissions = '{"marketing":{"edit":true}}'
WHERE merchant_id = '01ac0000-0000-4000-8000-000000000001'
  AND user_id = '01ac0000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SELECT public.test_assert_atomic_blog_error(NULL, '01ac0000-0000-4000-8000-000000000001',
  '{"title":"Denied create","slug":"denied-create","content":"Denied","author_name":"Staff"}'::jsonb,
  NULL, '42501', 'merchant_marketing_create_permission_required');
RESET ROLE;

UPDATE public.staff_members SET permissions = '{"marketing":{"create":true,"edit":true}}'
WHERE merchant_id = '01ac0000-0000-4000-8000-000000000001'
  AND user_id = '01ac0000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SELECT public.test_assert_atomic_blog_error('01ac0000-0000-4000-8000-000000000006',
  '01ac0000-0000-4000-8000-000000000001', '{"title":"Cross tenant"}'::jsonb,
  NULL, 'P0002', 'blog_post_not_found');
SELECT public.test_assert_atomic_blog_error(:'post_id'::uuid, '01ac0000-0000-4000-8000-000000000001',
  '{"title":"Foreign product"}'::jsonb, ARRAY['01ac0000-0000-4000-8000-000000000007'::uuid],
  'P0002', 'embedded_product_not_found_or_not_owned');
SELECT public.test_assert_atomic_blog_error(:'post_id'::uuid, '01ac0000-0000-4000-8000-000000000001',
  '{"title":"Too many"}'::jsonb, :'product_ids'::uuid[], '22023', 'too_many_embedded_product_ids');
SELECT id FROM public.mutate_merchant_blog_post_with_product_links(
  :'post_id'::uuid, '01ac0000-0000-4000-8000-000000000001', '{"title":"Preserved"}'::jsonb, NULL);
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.blog_post_products
  WHERE blog_post_id = :'post_id'::uuid), 'null embedded products did not preserve links');

SET LOCAL ROLE authenticated;
SELECT id FROM public.mutate_merchant_blog_post_with_product_links(
  :'post_id'::uuid, '01ac0000-0000-4000-8000-000000000001',
  '{"title":"Ordered links"}'::jsonb, :'ordered_product_ids'::uuid[]);
RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT array_agg(link.product_id ORDER BY link.position) = :'ordered_product_ids'::uuid[]
   FROM public.blog_post_products AS link
   WHERE link.blog_post_id = :'post_id'::uuid)
  AND (SELECT array_agg(link.position ORDER BY link.position) = ARRAY[1, 2]::integer[]
       FROM public.blog_post_products AS link
       WHERE link.blog_post_id = :'post_id'::uuid),
  'embedded product links did not preserve the RPC product ID order'
);

SET LOCAL ROLE authenticated;
SELECT id FROM public.mutate_merchant_blog_post_with_product_links(
  :'post_id'::uuid, '01ac0000-0000-4000-8000-000000000001', '{"title":"Cleared"}'::jsonb, ARRAY[]::uuid[]);
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.blog_post_products
  WHERE blog_post_id = :'post_id'::uuid), 'empty embedded products did not clear links');

SET LOCAL ROLE authenticated;
SELECT id FROM public.mutate_merchant_blog_post_with_product_links(
  :'post_id'::uuid, '01ac0000-0000-4000-8000-000000000001', '{"title":"Before rollback"}'::jsonb,
  ARRAY[:'first_product_id'::uuid]);
RESET ROLE;
CREATE TRIGGER test_atomic_blog_link_failure BEFORE INSERT ON public.blog_post_products
FOR EACH ROW EXECUTE FUNCTION public.test_atomic_blog_link_insert_failure();
SET LOCAL ROLE authenticated;
SELECT public.test_assert_atomic_blog_error(:'post_id'::uuid, '01ac0000-0000-4000-8000-000000000001',
  '{"title":"Must rollback"}'::jsonb, ARRAY[:'first_product_id'::uuid],
  'P0001', 'forced_blog_link_insert_failure');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT title = 'Before rollback' FROM public.blog_posts
  WHERE id = :'post_id'::uuid) AND (SELECT count(*) = 1 FROM public.blog_post_products
  WHERE blog_post_id = :'post_id'::uuid), 'atomic blog product-link RPC left a partial mutation');

-- The scope trigger forces fresh inserts unclaimed, so the claimed
-- fixture lands in two steps like the sweep itself would.
INSERT INTO public.blog_media_delete_tombstones (path)
VALUES ('platform/blog/atomic-swept.webp');
UPDATE public.blog_media_delete_tombstones SET claimed = TRUE
WHERE path = 'platform/blog/atomic-swept.webp';
SET LOCAL ROLE authenticated;
SELECT public.test_assert_atomic_blog_media_error(:'post_id'::uuid,
  '01ac0000-0000-4000-8000-000000000001', '{"title":"Must abort on swept media"}'::jsonb,
  ARRAY['platform/blog/atomic-swept.webp'], 'P0001', 'merchant_blog_media_swept_during_save');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT title = 'Before rollback' FROM public.blog_posts
  WHERE id = :'post_id'::uuid), 'atomic media verify left a partial mutation');

ROLLBACK;
