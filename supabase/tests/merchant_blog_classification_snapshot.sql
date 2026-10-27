SELECT test.assert(to_regprocedure('public.get_merchant_blog_classification_snapshot_v1(uuid,uuid[])') IS NOT NULL,
  'metadata snapshot RPC exists');

DELETE FROM public.merchant_blog_classifications
WHERE post_id='20000000-0000-0000-0000-000000000002';
INSERT INTO public.merchant_blog_classifications(
  post_id,merchant_id,intent,source,classifier_version,input_fingerprint
)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'buying-guide','merchant_declared','snapshot-test-v1',
  private.merchant_blog_input_fingerprint_v1(
    (SELECT p FROM public.blog_posts p WHERE p.id='20000000-0000-0000-0000-000000000001')
  )
)
ON CONFLICT(post_id) DO UPDATE SET
  intent=EXCLUDED.intent,source=EXCLUDED.source,classifier_version=EXCLUDED.classifier_version,
  input_fingerprint=EXCLUDED.input_fingerprint,stale_at=NULL;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false),
       set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT test.assert((
  SELECT count(*)=2 AND count(*) FILTER (WHERE intent IS NULL)=1
  FROM public.get_merchant_blog_classification_snapshot_v1(
    '10000000-0000-0000-0000-000000000001',
    ARRAY['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002']::uuid[]
  )
), 'owner sees classified and unclassified requested private posts');
SELECT test.assert((
  SELECT intent='buying-guide' AND source='merchant_declared'
    AND taxonomy_version=1 AND classifier_version='snapshot-test-v1'
    AND classified_at IS NOT NULL AND stale_at IS NULL AND post_updated_at IS NOT NULL
  FROM public.get_merchant_blog_classification_snapshot_v1(
    '10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[]
  )
), 'snapshot returns classification and article revision metadata');
SELECT test.assert((
  SELECT intent IS NULL AND source IS NULL AND classified_at IS NULL AND stale_at IS NULL
  FROM public.get_merchant_blog_classification_snapshot_v1(
    '10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000002']::uuid[]
  )
), 'snapshot includes unclassified posts with null classification metadata');
SELECT test.assert((
  SELECT count(*)=1 AND bool_and(post_id='20000000-0000-0000-0000-000000000001'::uuid)
  FROM public.get_merchant_blog_classification_snapshot_v1(
    '10000000-0000-0000-0000-000000000001',
    ARRAY['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003']::uuid[]
  )
), 'snapshot is tenant-scoped');
SELECT test.assert((
  SELECT count(*)=0 FROM public.get_merchant_blog_classification_snapshot_v1(
    '10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000004']::uuid[]
  )
), 'snapshot omits platform posts');
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000001',NULL::uuid[])$q$,'22023');
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000001',array_fill('20000000-0000-0000-0000-000000000001'::uuid,ARRAY[201]))$q$,'22023');
SELECT test.denied($q$SELECT evidence_sha256 FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000001','{}')$q$,'42703');
SELECT test.denied($q$SELECT content FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000001','{}')$q$,'42703');
SELECT test.denied($q$SELECT input_fingerprint FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000001','{}')$q$,'42703');
SELECT test.denied($q$SELECT actor_id FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000001','{}')$q$,'42703');
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000001',array_fill('20000000-0000-0000-0000-000000000001'::uuid,ARRAY[201]))$q$,'22023');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false),
       set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
SELECT test.assert((
  SELECT count(*)=1 FROM public.get_merchant_blog_classification_snapshot_v1(
    '10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000002']::uuid[]
  )
), 'authorized marketing editor can inspect snapshot metadata');
RESET ROLE;

INSERT INTO private.merchant_blog_classification_writers(auth_user_id,merchant_id,allowed_sources,expires_at) VALUES
 ('00000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001',ARRAY['verified_receipt'],now()+interval '1 hour')
ON CONFLICT(auth_user_id,merchant_id) DO UPDATE SET
  allowed_sources=EXCLUDED.allowed_sources,active=true,expires_at=EXCLUDED.expires_at;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false),
       set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
SELECT test.assert((
  SELECT count(*)=1 FROM public.get_merchant_blog_classification_snapshot_v1(
    '10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[]
  )
), 'scoped classification writer can inspect snapshot metadata');
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000002',ARRAY['20000000-0000-0000-0000-000000000003']::uuid[])$q$);
RESET ROLE;

UPDATE public.blog_posts SET content='<p>Changed after classification.</p>'
WHERE id='20000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false),
       set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT test.assert((
  SELECT stale_at IS NOT NULL AND intent='buying-guide'
  FROM public.get_merchant_blog_classification_snapshot_v1(
    '10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[]
  )
), 'snapshot retains stale classification metadata');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',false),set_config('request.jwt.claim.sub','',false);
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000001','{}')$q$);
RESET ROLE;

SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false),
       set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT test.denied($q$SELECT * FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000001','{}')$q$);
RESET ROLE;

SELECT 'merchant blog classification metadata snapshot checks passed' AS result;
