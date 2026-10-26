SELECT test.assert(to_regclass('public.merchant_blog_classifications') IS NOT NULL,'merchant classification storage must exist');
INSERT INTO private.merchant_blog_classification_writers(auth_user_id,merchant_id,allowed_sources,expires_at) VALUES
 ('00000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001',ARRAY['verified_receipt','reviewed'],now()+interval '1 hour'),
 ('00000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001',ARRAY['verified_receipt'],now()-interval '1 hour');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT test.denied('SELECT * FROM private.merchant_blog_classification_writers');
SELECT test.denied('SELECT * FROM private.merchant_blog_classification_audit');
SELECT test.denied('INSERT INTO public.merchant_blog_classifications DEFAULT VALUES');
SELECT test.denied('UPDATE public.merchant_blog_classifications SET source=''reviewed''');
SELECT test.denied('DELETE FROM public.merchant_blog_classifications');
SELECT test.denied('SELECT * FROM public.merchant_blog_classifications');
SELECT test.assert((SELECT count(*)=2 FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002']::uuid[])),'owner can inspect own private classification inputs');
SELECT test.assert((SELECT title='iPhone guide' AND content='<p>Verified article.</p>' AND length(input_fingerprint)=64 FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])),'context includes bound content and SHA256 fingerprint');
SELECT test.assert((SELECT slug='iphone-guide' FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])),'receipt verification receives current article slug');
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000002',ARRAY['20000000-0000-0000-0000-000000000003']::uuid[])$q$);
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001',array_fill('20000000-0000-0000-0000-000000000001'::uuid,ARRAY[21]))$q$,'22023');
DO $$ DECLARE hash text; BEGIN
 SELECT input_fingerprint INTO hash FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[]);
 PERFORM test.denied(format('SELECT public.set_merchant_blog_classification_v1(%L,%L,%L,%L,%L,%L,%L)','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','buying-guide',hash,'test-v1',repeat('a',64),'reviewed'));
 PERFORM public.set_merchant_blog_classification_v1('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','buying-guide',hash,'merchant-v1',NULL,'merchant_declared');
 PERFORM test.denied(format('SELECT public.set_merchant_blog_classification_v1(%L,%L,%L,%L,%L)', '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','news',hash,'merchant-v1'),'42501');
 PERFORM test.denied(format('SELECT public.set_merchant_blog_classification_v1(%L,%L,%L,%L,%L)', '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','news',repeat('0',64),'merchant-v1'),'40001');
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
SELECT test.assert((SELECT count(*)=1 FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])),'marketing editor can inspect classifications');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])$q$);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])$q$);
RESET ROLE;
-- Private helpers enforce the same authority even when invoked directly.
-- Use the session owner so the rejection comes from the helper's authorization
-- checks, not the authenticated role's lack of schema/function privileges.
SELECT set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','',false);
SELECT test.denied($q$SELECT * FROM private.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001','{}')$q$);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
SELECT test.denied($q$SELECT * FROM private.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000002','{}')$q$);
SET ROLE authenticated;
DO $$ DECLARE hash text; BEGIN
 SELECT input_fingerprint INTO hash FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[]);
 PERFORM test.denied(format('SELECT public.set_merchant_blog_classification_v1(%L,%L,%L,%L,%L,NULL,%L)','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','news',hash,'receipt-v1','verified_receipt'),'22023');
 PERFORM test.denied(format('SELECT public.set_merchant_blog_classification_v1(%L,%L,%L,%L,%L,%L,%L)','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','platform',hash,'receipt-v1',repeat('b',64),'verified_receipt'),'22023');
END $$;
RESET ROLE;
UPDATE private.merchant_blog_classification_writers SET active=false WHERE auth_user_id='00000000-0000-0000-0000-000000000005';
SET ROLE authenticated;
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001','{}')$q$);
RESET ROLE;
UPDATE private.merchant_blog_classification_writers SET active=true WHERE auth_user_id='00000000-0000-0000-0000-000000000005';
SET ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',false),set_config('request.jwt.claim.sub','',false);
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001','{}')$q$);
SELECT test.assert((SELECT count(*)=1 FROM public.get_storefront_blog_classifications_v1('10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])),'public projection returns current published classifications');
SELECT test.assert((SELECT post_updated_at IS NOT NULL FROM public.get_storefront_blog_classifications_v1('10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])),'safe projection binds classification to the article metadata revision');
SELECT test.assert((SELECT count(*)=0 FROM public.get_storefront_blog_classifications_v1('10000000-0000-0000-0000-000000000002',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])),'public projection scopes merchant');
SELECT test.denied($q$SELECT actor_id FROM public.get_storefront_blog_classifications_v1('10000000-0000-0000-0000-000000000001','{}')$q$,'42703');
SELECT test.denied($q$SELECT * FROM public.get_storefront_blog_classifications_v1('10000000-0000-0000-0000-000000000001',array_fill('20000000-0000-0000-0000-000000000001'::uuid,ARRAY[201]))$q$,'22023');
RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_context_v1('10000000-0000-0000-0000-000000000001','{}')$q$);
RESET ROLE;
