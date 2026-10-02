BEGIN;
INSERT INTO auth.users(id) VALUES('ab120000-0000-4000-8000-000000000001');
-- Privileged fixture setup has an audit actor; JWT identity starts only after both tenants exist.
SELECT set_config('app.audit_actor_user_id','ab120000-0000-4000-8000-000000000001',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug,is_published) VALUES
 ('ab120000-0000-4000-8000-000000000002','ab120000-0000-4000-8000-000000000001','guard@example.test','Guard','guard-test',true),
 ('ab120000-0000-4000-8000-000000000003',NULL,'other-guard@example.test','Other','other-guard',true);
INSERT INTO public.products(id,merchant_id,name,slug,price,status,metadata,specifications,discovery_metadata) VALUES
 ('ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002','Guarded','guarded-test',1,'active',
  '{"serial":9007199254740993,"ratio":0.123456789012345678901}', '{"serial":9007199254740993}',NULL),
 ('ab120000-0000-4000-8000-000000000005','ab120000-0000-4000-8000-000000000003','Other','other-test',1,'active','{}','{}',NULL);
SELECT set_config('app.test_other_revision',revision,true)
 FROM public.get_product_discovery_research_page('ab120000-0000-4000-8000-000000000003',NULL);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ab120000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$
DECLARE n integer; revision text; old_revision text; field text; value jsonb;
BEGIN
 SELECT count(*) INTO n FROM public.get_product_discovery_research_page('ab120000-0000-4000-8000-000000000003',NULL);
 IF n<>0 THEN RAISE EXCEPTION 'reader leaked another merchant'; END IF;
 SELECT count(*) INTO n FROM public.get_product_discovery_research_page('ab120000-0000-4000-8000-000000000002','ab120000-0000-4000-8000-000000000004');
 IF n<>0 THEN RAISE EXCEPTION 'reader cursor ignored'; END IF;
 SELECT r.revision,r.product->'metadata' INTO revision,value FROM public.get_product_discovery_research_page('ab120000-0000-4000-8000-000000000002',NULL) r;
 IF revision !~ '^[a-f0-9]{64}$' OR (value->>'serial')<>'9007199254740993'
 THEN RAISE EXCEPTION 'lossless source and revision missing'; END IF;
 -- A JavaScript-rounded source cannot equal the stored JSONB. No source echo is required now.
 IF value->'serial'='9007199254740992'::jsonb THEN RAISE EXCEPTION 'precision fixture collapsed'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
  'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002',
  '{"product_type":"phone","attributes":{"ram_gb":8}}',revision);
 IF n<>1 THEN RAISE EXCEPTION 'unchanged large-number source save failed'; END IF;
 old_revision:=revision;
 SELECT r.revision INTO revision FROM public.get_product_discovery_research_page('ab120000-0000-4000-8000-000000000002',NULL) r;
 IF revision=old_revision THEN RAISE EXCEPTION 'facts change did not update revision'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
  'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002','{}',old_revision);
 IF n<>0 THEN RAISE EXCEPTION 'stale facts saved'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
  'ab120000-0000-4000-8000-000000000005','ab120000-0000-4000-8000-000000000003','{}',current_setting('app.test_other_revision'));
 IF n<>0 THEN RAISE EXCEPTION 'cross merchant saved'; END IF;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
  'ab120000-0000-4000-8000-000000000005','ab120000-0000-4000-8000-000000000002','{}',current_setting('app.test_other_revision'));
 IF n<>0 THEN RAISE EXCEPTION 'mismatched pair saved'; END IF;
 -- Source edits cover each guarded field; matching fresh revisions remain usable.
 FOREACH field IN ARRAY ARRAY['name','category','metadata','specifications','mpn','color'] LOOP
  SELECT r.revision INTO revision FROM public.get_product_discovery_research_page('ab120000-0000-4000-8000-000000000002',NULL) r;
  IF field IN ('metadata','specifications') THEN
   EXECUTE format('UPDATE public.products SET %I=$1 WHERE id=$2',field)
    USING '{"serial":9007199254740992}'::jsonb,'ab120000-0000-4000-8000-000000000004'::uuid;
  ELSE
   EXECUTE format('UPDATE public.products SET %I=$1 WHERE id=$2',field)
    USING 'Changed','ab120000-0000-4000-8000-000000000004'::uuid;
  END IF;
  SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
   'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002','{}',revision);
  IF n<>0 THEN RAISE EXCEPTION 'stale % source saved',field; END IF;
 END LOOP;
 SELECT r.revision INTO revision FROM public.get_product_discovery_research_page('ab120000-0000-4000-8000-000000000002',NULL) r;
 SELECT count(*) INTO n FROM public.update_product_discovery_metadata_guarded(
  'ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002','{}',revision);
 IF n<>1 THEN RAISE EXCEPTION 'refreshed revision could not save'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.update_product_discovery_metadata_guarded(uuid,uuid,jsonb,text)','EXECUTE')
  OR has_function_privilege('anon','public.get_product_discovery_research_page(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'anonymous review access'; END IF;
 IF to_regprocedure('public.update_product_discovery_metadata_guarded(uuid,uuid,jsonb,jsonb,jsonb)') IS NOT NULL
 THEN RAISE EXCEPTION 'lossy guard overload remains'; END IF;
END $$;
ROLLBACK;
