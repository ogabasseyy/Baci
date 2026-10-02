BEGIN;
INSERT INTO auth.users (id) VALUES ('ab120000-0000-4000-8000-000000000001');
-- Use the database-principal audit actor for privileged fixture setup.
-- Authenticate the actual RLS assertions only after both tenant rows exist.
SELECT set_config('app.audit_actor_user_id','ab120000-0000-4000-8000-000000000001',true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('ab120000-0000-4000-8000-000000000002','ab120000-0000-4000-8000-000000000001','guard@example.test','Guard test','guard-test',true),
('ab120000-0000-4000-8000-000000000003',NULL,'other-guard@example.test','Other guard','other-guard',true);
INSERT INTO public.products (id, merchant_id, name, slug, price, status, discovery_metadata)
VALUES ('ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002','Guarded test','guarded-test',1,'active',NULL),
('ab120000-0000-4000-8000-000000000005','ab120000-0000-4000-8000-000000000003','Other test','other-test',1,'active',NULL);
SELECT set_config('app.test_other_source',jsonb_build_object(
 'name',name,'category',category,'metadata',metadata,'specifications',specifications,'mpn',mpn,'color',color)::text,true)
 FROM public.products WHERE id='ab120000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ab120000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$
DECLARE n integer; source jsonb; changed_source jsonb; source_key text;
BEGIN
 SELECT jsonb_build_object('name',name,'category',category,'metadata',metadata,
   'specifications',specifications,'mpn',mpn,'color',color) INTO source
 FROM public.products WHERE id='ab120000-0000-4000-8000-000000000004';
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
 'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002',
 '{"product_type":"phone","attributes":{"ram_gb":8}}',NULL,source);
 IF n <> 1 THEN RAISE EXCEPTION 'NULL snapshot failed'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
 'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002',
 '{"model":"verified"}', '{"attributes":{"ram_gb":8.0}, "product_type":"phone"}',source);
 IF n <> 1 THEN RAISE EXCEPTION 'semantic JSONB equality failed'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
 'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002','{}',NULL,source);
 IF n <> 0 THEN RAISE EXCEPTION 'stale snapshot updated'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
 'ab120000-0000-4000-8000-000000000005','ab120000-0000-4000-8000-000000000003','{}',NULL,current_setting('app.test_other_source')::jsonb);
 IF n <> 0 THEN RAISE EXCEPTION 'cross merchant updated'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
 'ab120000-0000-4000-8000-000000000005','ab120000-0000-4000-8000-000000000002','{}',NULL,current_setting('app.test_other_source')::jsonb);
 IF n <> 0 THEN RAISE EXCEPTION 'mismatched product and merchant updated'; END IF;
 FOREACH source_key IN ARRAY ARRAY['name','category','metadata','specifications','mpn','color'] LOOP
   changed_source := jsonb_set(source, ARRAY[source_key], '"changed"'::jsonb);
   SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
   'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002',
   '{}','{"model":"verified"}',changed_source);
   IF n <> 0 THEN RAISE EXCEPTION 'changed source % updated',source_key; END IF;
 END LOOP;
 UPDATE public.products SET name='Renamed' WHERE id='ab120000-0000-4000-8000-000000000004';
 IF (SELECT discovery_metadata FROM public.products WHERE id='ab120000-0000-4000-8000-000000000004')
   IS DISTINCT FROM '{"model":"verified"}'::jsonb
 THEN RAISE EXCEPTION 'source edit changed facts before guard assertion'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
 'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002',
 '{}','{"model":"verified"}',source);
 IF n <> 0 THEN RAISE EXCEPTION 'stale research source updated'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.update_product_discovery_metadata_guarded(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'anon can mutate'; END IF;
END $$;
ROLLBACK;
