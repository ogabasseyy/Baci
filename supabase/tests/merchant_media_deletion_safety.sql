-- Metadata-only fixture: no file bytes are uploaded or removed by this suite.
BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO auth.users(id,email) VALUES('36690000-0000-4000-8000-000000000010','media-owner@example.test');
INSERT INTO public.merchants(id,user_id,email,business_name,slug) VALUES
 ('36690000-0000-4000-8000-000000000001','36690000-0000-4000-8000-000000000010','media@example.test','Media fixture','media-safety-fixture');
INSERT INTO storage.objects(id,bucket_id,name) VALUES
 ('36690000-0000-4000-8000-000000000002','media','36690000-0000-4000-8000-000000000001/used.webp'),
 ('36690000-0000-4000-8000-000000000003','media','36690000-0000-4000-8000-000000000001/orphan.webp');
INSERT INTO public.products(id,merchant_id,name,slug,price,images,status) VALUES
 ('36690000-0000-4000-8000-000000000020','36690000-0000-4000-8000-000000000001','Media product','media-safety-product',10,
 '["https://example.test/storage/v1/object/public/media/36690000-0000-4000-8000-000000000001/%75sed.webp"]','active');
SELECT set_config('request.jwt.claims','{"sub":"36690000-0000-4000-8000-000000000010","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','36690000-0000-4000-8000-000000000010',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $cases$
DECLARE result record; denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.claim_merchant_media_deletion('36690000-0000-4000-8000-000000000001','36690000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'referenced media qualified for deletion';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'media_in_use' THEN RAISE;END IF; END;
 SELECT * INTO STRICT result FROM public.claim_merchant_media_deletion('36690000-0000-4000-8000-000000000001','36690000-0000-4000-8000-000000000003');
 IF result.path<>'36690000-0000-4000-8000-000000000001/orphan.webp' OR result.state<>'pending' THEN
  RAISE EXCEPTION 'opaque ID did not resolve canonical path'; END IF;
 IF public.complete_merchant_media_deletion('36690000-0000-4000-8000-000000000001',result.path) THEN
  RAISE EXCEPTION 'metadata-present removal falsely reported completion'; END IF;
 IF public.merchant_media_path_writable(result.path) THEN RAISE EXCEPTION 'pending path could be overwritten'; END IF;
 -- The reference guard applies even to a privileged source writer: both direct
 -- catalog mutation and an encoded rich-text reference must honor admission.
 BEGIN
  UPDATE public.products SET images='["36690000-0000-4000-8000-000000000001/orphan.webp"]'
   WHERE id='36690000-0000-4000-8000-000000000020';
  RAISE EXCEPTION 'new reference to claimed media accepted';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'media_pending_deletion' THEN RAISE; END IF; END;
 SELECT * INTO STRICT result FROM public.claim_merchant_media_deletion('36690000-0000-4000-8000-000000000001','orphan.webp');
 IF result.state<>'pending' THEN RAISE EXCEPTION 'pending retry changed state'; END IF;
END
$cases$;
SELECT set_config('request.jwt.claim.sub','36690000-0000-4000-8000-000000000099',true);
SELECT set_config('request.jwt.claims','{"sub":"36690000-0000-4000-8000-000000000099","role":"authenticated"}',true);
DO $tenant$
BEGIN
 BEGIN
  PERFORM public.claim_merchant_media_deletion('36690000-0000-4000-8000-000000000001','orphan.webp');
  RAISE EXCEPTION 'foreign actor inspected deletion';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF public.merchant_media_delete_allowed('36690000-0000-4000-8000-000000000001/orphan.webp','36690000-0000-4000-8000-000000000003') THEN
  RAISE EXCEPTION 'foreign actor obtained Storage permission'; END IF;
 IF has_function_privilege('anon','public.claim_merchant_media_deletion(uuid,text)','EXECUTE') THEN
  RAISE EXCEPTION 'anonymous deletion admission granted'; END IF;
END
$tenant$;
ROLLBACK;
