-- Requires the isolated empty-database fixture; never run against production.
BEGIN;
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000001','ogabassey'),('10000000-0000-4000-8000-000000000002','other');
INSERT INTO public.imei_lookups(id,merchant_id,imei_hash,status,tier,cached_response) VALUES
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','hash-a','completed','basic','{"data":{"deviceProfile":{"version":1,"brand":"Apple","model":"iPhone 17 Pro Max","color":"Silver","storage":"512GB","imageMatch":"color"}}}'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','hash-a','completed','blacklist','{"data":{"deviceProfile":{"version":1,"brand":"Apple","model":"IPHONE 17 PRO MAX","color":"Silver","storage":"512GB","imageMatch":"color"}}}'),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','hash-b','pending_provider','basic',null),
('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','hash-c','completed','basic','{"data":{"deviceProfile":{"brand":"Samsung","model":"Galaxy S24"}}}');
INSERT INTO public.imei_lookups(id,merchant_id,imei_hash,status,tier,cached_response) VALUES
('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','hash-d','completed','basic','{"data":{"device":"Legacy iPhone","imei":"490154203237518"}}');
INSERT INTO public.imei_lookups(id,merchant_id,imei_hash,status,tier,created_at) VALUES
('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','hash-e','completed','basic',now()-interval '40 days');
DO $$ BEGIN
 IF has_function_privilege('anon','public.get_admin_imei_check_analytics(text,text)','execute') THEN RAISE EXCEPTION 'anon can execute analytics'; END IF;
 IF has_function_privilege('service_role','public.get_admin_imei_check_analytics(text,text)','execute') THEN RAISE EXCEPTION 'service_role can execute analytics'; END IF;
 BEGIN
  PERFORM public.get_admin_imei_check_analytics('7d','ogabassey');
  RAISE EXCEPTION 'missing session accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.get_admin_imei_check_analytics('7d','ogabassey');
  RAISE EXCEPTION 'non-admin accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
 BEGIN PERFORM public.get_admin_imei_check_analytics('all',NULL); RAISE EXCEPTION 'non-admin cross-merchant read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r := public.get_admin_imei_check_analytics('7d','ogabassey');
 IF r->'summary' <> '{"requests":4,"completed":3,"uniqueDevices":2,"unidentified":1,"matchedImages":2}'::jsonb THEN RAISE EXCEPTION 'incorrect counters: %',r; END IF;
 IF r#>>'{topModels,0,checks}' <> '2' OR r#>>'{topModels,0,uniqueDevices}' <> '1' THEN RAISE EXCEPTION 'incorrect ranking: %',r; END IF;
 IF r#>>'{topVariants,0,color}' <> 'Silver' THEN RAISE EXCEPTION 'missing colour'; END IF;
 IF r::text LIKE '%hash-a%' OR r::text LIKE '%hash-c%' OR r::text LIKE '%490154203237518%' OR r::text LIKE '%Legacy iPhone%' THEN RAISE EXCEPTION 'hash leaked'; END IF;
 IF jsonb_array_length(r->'topModels') <> 1 THEN RAISE EXCEPTION 'merchant scope failed'; END IF;
 IF public.get_admin_imei_check_analytics('90d','ogabassey')#>>'{summary,completed}' <> '4' THEN RAISE EXCEPTION 'period scope failed'; END IF;
 BEGIN PERFORM public.get_admin_imei_check_analytics('invalid',NULL); RAISE EXCEPTION 'bad period accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
-- Replaying/updating the same durable lookup never creates another check.
UPDATE public.imei_lookups SET cached_response=cached_response WHERE id='20000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r := public.get_admin_imei_check_analytics('7d','ogabassey');
 IF r#>>'{summary,completed}' <> '3' THEN RAISE EXCEPTION 'replay overcount'; END IF;
END $$;
-- Cross-merchant identity keys must include merchant_id, even for identical hashes.
RESET ROLE;
UPDATE public.imei_lookups SET imei_hash='hash-a' WHERE id='20000000-0000-4000-8000-000000000004';
INSERT INTO public.imei_lookups(id,merchant_id,imei_hash,status,tier,cached_response,created_at) VALUES
('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','hash-ancient','completed','basic','{"data":{"deviceProfile":{"brand":"Google","model":"Pixel 9"}}}',now()-interval '400 days');
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r := public.get_admin_imei_check_analytics('7d',NULL);
 IF r#>>'{summary,requests}' <> '5' OR r#>>'{summary,completed}' <> '4' OR r#>>'{summary,uniqueDevices}' <> '3' THEN RAISE EXCEPTION 'cross-merchant aggregation/deduplication failed: %',r; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'topModels') x WHERE x->>'model'='Galaxy S24') THEN RAISE EXCEPTION 'other merchant model omitted'; END IF;
 IF r::text LIKE '%hash-%' OR r::text LIKE '%490154203237518%' THEN RAISE EXCEPTION 'cross-merchant identifier leaked'; END IF;
 r := public.get_admin_imei_check_analytics('all',NULL);
 IF r#>>'{summary,requests}' <> '7' OR r#>>'{summary,completed}' <> '6' OR r#>>'{summary,uniqueDevices}' <> '5' THEN RAISE EXCEPTION 'all-time window failed: %',r; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'topModels') x WHERE x->>'model'='Pixel 9') THEN RAISE EXCEPTION 'all-time old model omitted'; END IF;
 IF r::text LIKE '%hash-%' THEN RAISE EXCEPTION 'all-time identifier leaked'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
