-- Real RPC regression: fresh news must not occupy the 64 guide-candidate slots.
BEGIN;
UPDATE public.merchant_feature_settings SET blog_enabled=true
WHERE merchant_id='10000000-0000-0000-0000-000000000001';
INSERT INTO public.blog_posts(id,merchant_id,title,content,slug,category,status,published_at,search_vector)
SELECT ('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  '10000000-0000-0000-0000-000000000001','iPhone options','<p>Distinct article.</p>',
  'classified-iphone-'||i,'Smartphones','published',
  '2026-01-01'::timestamptz + (i||' hours')::interval,to_tsvector('english','iphone')
FROM generate_series(1,71) i;
INSERT INTO public.merchant_blog_classifications(post_id,merchant_id,intent,source,classifier_version,input_fingerprint)
SELECT id,merchant_id,CASE WHEN slug='classified-iphone-1' THEN 'buying-guide' ELSE 'news' END,
  'merchant_declared','test-v1',private.merchant_blog_input_fingerprint_v1(p)
FROM public.blog_posts p WHERE slug LIKE 'classified-iphone-%';
SET LOCAL ROLE anon;
SELECT test.assert((SELECT count(*)=1 FROM public.get_storefront_cluster_guide_candidates_v1(
  '10000000-0000-0000-0000-000000000001','smartphones',
  '[{"rule_order":0,"category_slug":"smartphones","category_names":["Smartphones"],"article_tokens":["iphone"]}]',
  'iphone',64)), 'fresh classified news is excluded before the bounded candidate cap');
SELECT test.assert(to_regprocedure('public.get_storefront_cluster_guide_candidates_v2(uuid,text,jsonb,text,integer)') IS NOT NULL,
  'new public guide projection is present');
SELECT test.assert((SELECT merchant_intent='buying-guide' AND merchant_intent_source='merchant_declared'
  AND slug='classified-iphone-1'
  FROM public.get_storefront_cluster_guide_candidates_v2(
  '10000000-0000-0000-0000-000000000001','smartphones',
  '[{"rule_order":0,"category_slug":"smartphones","category_names":["Smartphones"],"article_tokens":["iphone"]}]',
  'iphone',64)), 'persisted guide intent reaches actual RPC without guide keywords in title');
RESET ROLE;
INSERT INTO public.blog_posts(id,merchant_id,title,content,slug,category,status,published_at,search_vector)
VALUES('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',
  'iPhone options','<p>Other merchant article.</p>','other-merchant-iphone-guide','Smartphones',
  'published',now(),to_tsvector('english','iphone'));
INSERT INTO public.merchant_blog_classifications(post_id,merchant_id,intent,source,classifier_version,input_fingerprint)
SELECT id,merchant_id,'buying-guide','merchant_declared','test-v1',
  private.merchant_blog_input_fingerprint_v1(p)
FROM public.blog_posts p WHERE id='40000000-0000-0000-0000-000000000001';
SET LOCAL ROLE anon;
SELECT test.assert((SELECT count(*)=1 AND bool_and(slug='other-merchant-iphone-guide')
  AND NOT bool_or(slug='classified-iphone-1')
  FROM public.get_storefront_cluster_guide_candidates_v2(
    '10000000-0000-0000-0000-000000000002','smartphones',
    '[{"rule_order":0,"category_slug":"smartphones","category_names":["Smartphones"],"article_tokens":["iphone"]}]',
    'iphone',64)), 'valid rules return only the requested merchant guide, not another merchant guide or news');
RESET ROLE;
UPDATE public.blog_posts SET content='<p>Rewritten news requires reclassification.</p>'
WHERE slug='classified-iphone-71';
SET LOCAL ROLE anon;
SELECT test.assert((SELECT count(*)=2 FROM public.get_storefront_cluster_guide_candidates_v2(
  '10000000-0000-0000-0000-000000000001','smartphones',
  '[{"rule_order":0,"category_slug":"smartphones","category_names":["Smartphones"],"article_tokens":["iphone"]}]',
  'iphone',64)), 'stale news classification no longer excludes a candidate');
SELECT test.assert((SELECT merchant_intent IS NULL AND merchant_intent_source IS NULL
  FROM public.get_storefront_cluster_guide_candidates_v2(
  '10000000-0000-0000-0000-000000000001','smartphones',
  '[{"rule_order":0,"category_slug":"smartphones","category_names":["Smartphones"],"article_tokens":["iphone"]}]',
  'iphone',64) WHERE slug='classified-iphone-71'), 'stale intent cannot influence TypeScript consumer');
RESET ROLE;
UPDATE public.merchant_feature_settings SET blog_enabled=false
WHERE merchant_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE anon;
SELECT test.assert((SELECT count(*)=0 FROM public.get_storefront_cluster_guide_candidates_v2(
  '10000000-0000-0000-0000-000000000001','smartphones',
  '[{"rule_order":0,"category_slug":"smartphones","category_names":["Smartphones"],"article_tokens":["iphone"]}]',
  'iphone',64)), 'v2 retains the blog feature gate');
RESET ROLE;
ROLLBACK;
