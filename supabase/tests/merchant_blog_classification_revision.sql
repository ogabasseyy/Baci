SELECT test.assert(to_regclass('public.blog_posts') IS NOT NULL,
  'revision test fixture is available');

INSERT INTO public.blog_posts(
  id,merchant_id,title,content,slug,category,excerpt,tags,keywords,status,published_at,
  classification_revision
)
VALUES (
  '20000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000001',
  'Revision guide','<p>Original article.</p>','revision-guide','Smartphones',
  'Original excerpt','{phone}','{guide}','published',now(),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);

DO $test$
DECLARE
  v_initial uuid;
  v_current uuid;
BEGIN
  SELECT classification_revision INTO v_initial FROM public.blog_posts
  WHERE id='20000000-0000-0000-0000-000000000005';
  PERFORM test.assert(v_initial IS NOT NULL AND v_initial<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'insert always assigns a fresh non-null revision');

  INSERT INTO public.merchant_blog_classifications(
    post_id,merchant_id,intent,source,classifier_version,input_fingerprint
  )
  SELECT p.id,p.merchant_id,'buying-guide','merchant_declared','revision-test-v1',
    private.merchant_blog_input_fingerprint_v1(p)
  FROM public.blog_posts p WHERE p.id='20000000-0000-0000-0000-000000000005';

  UPDATE public.blog_posts SET view_count=view_count+1,
    classification_revision='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  WHERE id='20000000-0000-0000-0000-000000000005';
  SELECT classification_revision INTO v_current FROM public.blog_posts
  WHERE id='20000000-0000-0000-0000-000000000005';
  PERFORM test.assert(v_current=v_initial,
    'counter updates and direct revision spoofing preserve the content revision');
  PERFORM test.assert((
    SELECT stale_at IS NULL FROM public.merchant_blog_classifications
    WHERE post_id='20000000-0000-0000-0000-000000000005'
  ),'counter updates do not invalidate classification');

  UPDATE public.blog_posts SET content='<p>Edited article.</p>',
    classification_revision='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  WHERE id='20000000-0000-0000-0000-000000000005';
  SELECT classification_revision INTO v_current FROM public.blog_posts
  WHERE id='20000000-0000-0000-0000-000000000005';
  PERFORM test.assert(v_current IS DISTINCT FROM v_initial
    AND v_current<>'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'content edits get a server-generated revision despite direct spoofing');
  PERFORM test.assert((
    SELECT stale_at IS NOT NULL FROM public.merchant_blog_classifications
    WHERE post_id='20000000-0000-0000-0000-000000000005'
  ),'content edits retain classification invalidation');
  v_initial := v_current;

  UPDATE public.blog_posts SET title=title || ' edited'
  WHERE id='20000000-0000-0000-0000-000000000005';
  SELECT classification_revision INTO v_current FROM public.blog_posts
  WHERE id='20000000-0000-0000-0000-000000000005';
  PERFORM test.assert(v_current IS DISTINCT FROM v_initial,'title changes advance revision');
  v_initial := v_current;

  UPDATE public.blog_posts SET category=category || ' edited'
  WHERE id='20000000-0000-0000-0000-000000000005';
  SELECT classification_revision INTO v_current FROM public.blog_posts
  WHERE id='20000000-0000-0000-0000-000000000005';
  PERFORM test.assert(v_current IS DISTINCT FROM v_initial,'category changes advance revision');
  v_initial := v_current;

  UPDATE public.blog_posts SET excerpt=excerpt || ' edited'
  WHERE id='20000000-0000-0000-0000-000000000005';
  SELECT classification_revision INTO v_current FROM public.blog_posts
  WHERE id='20000000-0000-0000-0000-000000000005';
  PERFORM test.assert(v_current IS DISTINCT FROM v_initial,'excerpt changes advance revision');
  v_initial := v_current;

  UPDATE public.blog_posts SET tags=array_append(tags,'edited')
  WHERE id='20000000-0000-0000-0000-000000000005';
  SELECT classification_revision INTO v_current FROM public.blog_posts
  WHERE id='20000000-0000-0000-0000-000000000005';
  PERFORM test.assert(v_current IS DISTINCT FROM v_initial,'tag changes advance revision');
  v_initial := v_current;

  UPDATE public.blog_posts SET keywords=array_append(keywords,'edited')
  WHERE id='20000000-0000-0000-0000-000000000005';
  SELECT classification_revision INTO v_current FROM public.blog_posts
  WHERE id='20000000-0000-0000-0000-000000000005';
  PERFORM test.assert(v_current IS DISTINCT FROM v_initial,'keyword changes advance revision');

  UPDATE public.merchant_blog_classifications SET
    input_fingerprint=private.merchant_blog_input_fingerprint_v1(
      (SELECT p FROM public.blog_posts p WHERE p.id='20000000-0000-0000-0000-000000000005')
    ),stale_at=NULL
  WHERE post_id='20000000-0000-0000-0000-000000000005';
  PERFORM set_config('test.classification_revision',v_current::text,false);
END
$test$;

UPDATE public.merchant_feature_settings SET blog_enabled=true
WHERE merchant_id='10000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',false),set_config('request.jwt.claim.sub','',false);
SELECT test.assert((
  SELECT post_revision=current_setting('test.classification_revision')::uuid AND post_updated_at IS NOT NULL
  FROM public.get_storefront_blog_classifications_v1(
    '10000000-0000-0000-0000-000000000001',
    ARRAY['20000000-0000-0000-0000-000000000005']::uuid[]
  )
),'safe public projection returns stable revision alongside the legacy timestamp');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false),
       set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT test.assert((
  SELECT post_revision=current_setting('test.classification_revision')::uuid AND post_updated_at IS NOT NULL
  FROM public.get_merchant_blog_classification_snapshot_v1(
    '10000000-0000-0000-0000-000000000001',
    ARRAY['20000000-0000-0000-0000-000000000005']::uuid[]
  )
),'authorized snapshot returns stable revision alongside the legacy timestamp');
RESET ROLE;

SELECT 'merchant blog classification revision checks passed' AS result;
