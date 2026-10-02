BEGIN;
INSERT INTO auth.users (id) VALUES ('ab120000-0000-4000-8000-000000000001');
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('ab120000-0000-4000-8000-000000000002','ab120000-0000-4000-8000-000000000001','guard@example.test','Guard test','guard-test',true),
('ab120000-0000-4000-8000-000000000003',NULL,'other-guard@example.test','Other guard','other-guard',true);
INSERT INTO public.products (id, merchant_id, name, slug, price, status, discovery_metadata)
VALUES ('ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002','Guarded test','guarded-test',1,'active',NULL),
('ab120000-0000-4000-8000-000000000005','ab120000-0000-4000-8000-000000000003','Other test','other-test',1,'active',NULL);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ab120000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
 'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002',
 '{"product_type":"phone","attributes":{"ram_gb":8}}',NULL);
 IF n <> 1 THEN RAISE EXCEPTION 'NULL snapshot failed'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
 'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002',
 '{"model":"verified"}', '{"attributes":{"ram_gb":8.0}, "product_type":"phone"}');
 IF n <> 1 THEN RAISE EXCEPTION 'semantic JSONB equality failed'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
 'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002','{}',NULL);
 IF n <> 0 THEN RAISE EXCEPTION 'stale snapshot updated'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
 'ab120000-0000-4000-8000-000000000005','ab120000-0000-4000-8000-000000000003','{}',NULL);
 IF n <> 0 THEN RAISE EXCEPTION 'cross merchant updated'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.update_product_discovery_metadata_guarded(uuid,uuid,jsonb,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'anon can mutate'; END IF;
END $$;
ROLLBACK;
