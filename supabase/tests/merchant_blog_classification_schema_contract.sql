-- Schema-only assertions for the complete chronological replay. No live fixtures.
BEGIN;
DO $test$
BEGIN
  IF to_regclass('public.merchant_blog_classifications') IS NULL
    OR to_regclass('private.merchant_blog_classification_audit') IS NULL THEN
    RAISE EXCEPTION 'Classification storage missing after replay';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='public.blog_posts'::regclass AND conname='blog_posts_merchant_intent_null') THEN
    RAISE EXCEPTION 'Platform-only intent boundary missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute
    WHERE attrelid='public.blog_posts'::regclass AND attname='classification_revision'
      AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Stable classification revision missing';
  END IF;
  IF has_table_privilege('authenticated','public.merchant_blog_classifications','INSERT,UPDATE,DELETE')
    OR has_table_privilege('anon','public.merchant_blog_classifications','SELECT') THEN
    RAISE EXCEPTION 'Direct classification table access is not permitted';
  END IF;
  IF NOT has_function_privilege('authenticated',
    'public.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text)','EXECUTE')
    OR has_function_privilege('anon',
    'public.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text)','EXECUTE')
    OR has_function_privilege('service_role',
    'public.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Classification writer grants differ from contract';
  END IF;
  IF NOT has_function_privilege('anon','public.get_storefront_cluster_guide_candidates_v2(uuid,text,jsonb,text,integer)','EXECUTE')
    OR NOT has_function_privilege('anon','public.get_storefront_blog_classifications_v1(uuid,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'Safe public projections missing';
  END IF;
  IF has_schema_privilege('authenticated','private','USAGE') THEN
    RAISE EXCEPTION 'Authenticated role unexpectedly has private schema usage';
  END IF;
  IF has_function_privilege('service_role','public.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text)','EXECUTE')
    OR has_function_privilege('service_role','public.get_merchant_blog_classification_context_v1(uuid,uuid[])','EXECUTE')
    OR has_function_privilege('service_role','public.get_merchant_blog_classification_snapshot_v1(uuid,uuid[])','EXECUTE')
    OR has_function_privilege('service_role','public.get_storefront_blog_classifications_v1(uuid,uuid[])','EXECUTE')
    OR has_function_privilege('service_role','public.get_storefront_cluster_guide_candidates_v2(uuid,text,jsonb,text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Service role must not receive classification RPC execution';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text)'::regprocedure),
      ('public.get_merchant_blog_classification_context_v1(uuid,uuid[])'::regprocedure),
      ('public.get_merchant_blog_classification_snapshot_v1(uuid,uuid[])'::regprocedure),
      ('public.get_storefront_blog_classifications_v1(uuid,uuid[])'::regprocedure),
      ('public.get_storefront_cluster_guide_candidates_v2(uuid,text,jsonb,text,integer)'::regprocedure)
    ) AS rpc(function_oid)
    JOIN pg_proc AS definition ON definition.oid=rpc.function_oid
    JOIN pg_roles AS owner_role ON owner_role.oid=definition.proowner
    WHERE definition.prosecdef IS FALSE OR owner_role.rolname<>'postgres'
      OR NOT EXISTS(SELECT 1 FROM unnest(definition.proconfig) AS setting
        WHERE setting='search_path=""')
  ) THEN
    RAISE EXCEPTION 'Classification public RPCs must be postgres-owned definer trampolines with an empty search_path';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.blog_posts'::regclass
    AND tgname='invalidate_merchant_blog_classification' AND tgenabled='O')
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.blog_posts'::regclass
    AND tgname='set_blog_post_classification_revision' AND tgenabled='O') THEN
    RAISE EXCEPTION 'Classification input triggers missing';
  END IF;
END
$test$;
ROLLBACK;
