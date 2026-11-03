-- Reproduce the production private-schema boundary in the isolated fixture.
INSERT INTO public.merchant_blog_classifications(
  post_id,merchant_id,intent,source,classifier_version,input_fingerprint
)
SELECT post.id,post.merchant_id,'buying-guide','merchant_declared','private-boundary-test',
  private.merchant_blog_input_fingerprint_v1(post)
FROM public.blog_posts AS post
WHERE post.id='20000000-0000-0000-0000-000000000001'
ON CONFLICT(post_id) DO UPDATE SET intent=EXCLUDED.intent,source=EXCLUDED.source,
  classifier_version=EXCLUDED.classifier_version,input_fingerprint=EXCLUDED.input_fingerprint,
  stale_at=NULL,classified_at=statement_timestamp();
UPDATE public.blog_posts SET search_vector=to_tsvector('english','iphone')
WHERE id='20000000-0000-0000-0000-000000000001';
REVOKE USAGE ON SCHEMA private FROM authenticated;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false),
       set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);

SELECT test.assert(NOT has_schema_privilege('authenticated','private','USAGE'),
  'authenticated must not receive private schema usage');
SELECT test.assert((SELECT count(*)=1 FROM public.get_merchant_blog_classification_context_v1(
  '10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])),
  'approved context RPC works without private schema usage');
SELECT test.assert((SELECT count(*)=1 FROM public.get_merchant_blog_classification_snapshot_v1(
  '10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])),
  'approved snapshot RPC works without private schema usage');
SELECT test.assert((SELECT count(*)=1 FROM public.get_storefront_blog_classifications_v1(
  '10000000-0000-0000-0000-000000000001',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[])),
  'approved public classification projection works without private schema usage');
SELECT test.assert((SELECT merchant_intent='buying-guide'
    AND merchant_intent_source='merchant_declared'
  FROM public.get_storefront_cluster_guide_candidates_v2(
    '10000000-0000-0000-0000-000000000001','smartphones',
    '[{"rule_order":0,"category_slug":"smartphones","category_names":["Smartphones"],"article_tokens":["iphone"]}]'::jsonb,
    'iphone',64)
  WHERE slug='iphone-guide'),
  'approved public guide RPC returns current intent without private schema usage');

DO $test$
DECLARE v_fingerprint text;
BEGIN
  SELECT input_fingerprint INTO v_fingerprint
  FROM public.get_merchant_blog_classification_context_v1(
    '10000000-0000-0000-0000-000000000001',
    ARRAY['20000000-0000-0000-0000-000000000001']::uuid[]);
  PERFORM public.set_merchant_blog_classification_v1(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001','buying-guide',v_fingerprint,'boundary-test');
  PERFORM test.denied($q$SELECT * FROM public.get_merchant_blog_classification_context_v1(
    '10000000-0000-0000-0000-000000000002',ARRAY['20000000-0000-0000-0000-000000000003']::uuid[])$q$);
  PERFORM test.denied($q$SELECT * FROM public.get_merchant_blog_classification_snapshot_v1(
    '10000000-0000-0000-0000-000000000002',ARRAY['20000000-0000-0000-0000-000000000003']::uuid[])$q$);
  PERFORM test.denied(format($q$SELECT public.set_merchant_blog_classification_v1(
    %L,%L,'news',%L,'boundary-test')$q$,
    '10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',v_fingerprint));
  PERFORM test.denied($q$SELECT * FROM private.get_merchant_blog_classification_context_v1(
    '10000000-0000-0000-0000-000000000001','{}')$q$);
END
$test$;
RESET ROLE;
SELECT 'merchant blog classification private boundary checks passed' AS result;
