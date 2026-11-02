-- Empty disposable PostgreSQL fixture only. Never run on a deployed database.
\set ON_ERROR_STOP on
\ir scoped_baci_blog_release.sql
ALTER TABLE public.blog_posts ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.blog_posts ADD COLUMN search_vector tsvector;
\ir ../migrations/20261011210311_scoped_baci_blog_corrections.sql
\ir ../migrations/20261011210312_approved_baci_blog_correction_audit.sql
-- Match production's metadata allowlist; the receipt links to the private
-- immutable revision rather than broadening this sensitive audit contract.
CREATE FUNCTION private.platform_audit_metadata_valid_v1(p_metadata jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT jsonb_typeof(p_metadata)='object' AND NOT EXISTS (
  SELECT 1 FROM jsonb_object_keys(p_metadata) AS k(name)
  WHERE k.name NOT IN ('category','operation','reason_code','result')
 );
$$;
ALTER TABLE public.platform_audit_events ADD CONSTRAINT platform_audit_events_metadata_check
 CHECK (private.platform_audit_metadata_valid_v1(metadata));
\ir ../migrations/20261011211047_fix_baci_blog_correction_audit_metadata.sql
SET request.jwt.claim.sub = '';
INSERT INTO public.blog_posts
 (id,title,slug,content,excerpt,merchant_id,is_platform_post,status,published_at,featured_image_url)
VALUES
 ('df7c8d06-bfa2-4171-948e-548cb2f463a6','Bumpa','bumpa','Old body','Old excerpt',NULL,true,'published',now(),'https://example.com/cover.webp'),
 ('8642fd90-400b-4264-a954-f588da5ccd59','Selar','selar','Old body','Old excerpt',NULL,true,'published',now(),'https://example.com/cover.webp');
CREATE TEMP TABLE preserved AS SELECT id,title,slug,published_at,featured_image_url FROM public.blog_posts;
INSERT INTO baci_blog_release_private.corrections
 (id,publisher_id,post_id,expected_updated_at,expected_content_sha256,content,excerpt,word_count,reading_time_minutes,approved_by)
SELECT '66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',
 id,updated_at,encode(sha256(convert_to(content,'UTF8')),'hex'),'<p>Reviewed correction</p>','Correct excerpt',3,1,'Owner approved two-post updater'
FROM public.blog_posts WHERE slug='bumpa';
DO $$ BEGIN
 IF has_table_privilege('authenticated','baci_blog_release_private.corrections','INSERT')
 OR has_table_privilege('authenticated','baci_blog_release_private.corrections','UPDATE')
 OR has_table_privilege('authenticated','baci_blog_release_private.corrections','SELECT')
 OR has_function_privilege('anon','public.apply_approved_baci_blog_correction(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Correction approval boundary exposed'; END IF;
 BEGIN
  PERFORM public.apply_approved_baci_blog_correction('66666666-6666-6666-6666-666666666666');
  RAISE EXCEPTION 'Unauthenticated correction accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO baci_blog_release_private.corrections
   (publisher_id,post_id,expected_updated_at,expected_content_sha256,content,word_count,reading_time_minutes,approved_by)
  SELECT '11111111-1111-1111-1111-111111111111',id,now(),repeat('a',64),'Unapproved',1,1,'Owner'
  FROM public.blog_posts WHERE slug='approved';
  RAISE EXCEPTION 'Third post approved';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE baci_blog_release_private.corrections SET content='Substituted content';
  RAISE EXCEPTION 'Approved correction changed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.apply_approved_baci_blog_correction('66666666-6666-6666-6666-666666666666');
  RAISE EXCEPTION 'Other publisher correction accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- Approval hashes must be stable across ordinary API session timezones.
SET timezone = 'America/New_York';
SET ROLE authenticated;
SELECT public.apply_approved_baci_blog_correction('66666666-6666-6666-6666-666666666666');
SELECT public.apply_approved_baci_blog_correction('66666666-6666-6666-6666-666666666666');
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.blog_posts WHERE slug='bumpa'
  AND content='<p>Reviewed correction</p>' AND excerpt='Correct excerpt' AND word_count=3)
 OR EXISTS (SELECT 1 FROM preserved p JOIN public.blog_posts b USING(id)
  WHERE p.title IS DISTINCT FROM b.title OR p.slug IS DISTINCT FROM b.slug
   OR p.published_at IS DISTINCT FROM b.published_at OR p.featured_image_url IS DISTINCT FROM b.featured_image_url)
 THEN RAISE EXCEPTION 'Correction or preservation failed'; END IF;
 IF (SELECT count(*) FROM public.platform_audit_events WHERE action='platform_blog_post.corrected') <> 1
 OR NOT EXISTS (SELECT 1 FROM public.platform_audit_events WHERE action='platform_blog_post.corrected'
  AND actor_user_id='11111111-1111-1111-1111-111111111111'
  AND metadata->>'reason_code'='66666666-6666-6666-6666-666666666666')
 THEN RAISE EXCEPTION 'Correction receipt audit failed'; END IF;
 BEGIN
  UPDATE public.blog_posts SET title='Unauthorized title' WHERE slug='bumpa';
  RAISE EXCEPTION 'Correction opened arbitrary writes';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- An expired approval may replay without writing; it cannot reapply after a later edit.
UPDATE baci_blog_release_private.corrections SET revoked_at=now();
DO $$ BEGIN
 BEGIN
  PERFORM public.apply_approved_baci_blog_correction('66666666-6666-6666-6666-666666666666');
  RAISE EXCEPTION 'Revoked correction accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET request.jwt.claim.sub = '';
UPDATE public.blog_posts SET content='Later independent edit' WHERE slug='bumpa';
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
UPDATE baci_blog_release_private.corrections SET revoked_at=NULL;
DO $$ BEGIN
 BEGIN
  PERFORM public.apply_approved_baci_blog_correction('66666666-6666-6666-6666-666666666666');
  RAISE EXCEPTION 'Replay silently lost later edit';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
INSERT INTO baci_blog_release_private.corrections
 (id,publisher_id,post_id,expected_updated_at,expected_content_sha256,content,word_count,reading_time_minutes,approved_by,approved_at,expires_at)
SELECT '77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111',
 id,updated_at,encode(sha256(convert_to(content,'UTF8')),'hex'),'Expired',1,1,'Owner',now()-interval '2 hours',now()-interval '1 hour'
FROM public.blog_posts WHERE slug='selar';
DO $$ BEGIN
 BEGIN
  PERFORM public.apply_approved_baci_blog_correction('77777777-7777-7777-7777-777777777777');
  RAISE EXCEPTION 'Expired correction accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
INSERT INTO baci_blog_release_private.corrections
 (id,publisher_id,post_id,expected_updated_at,expected_content_sha256,content,word_count,reading_time_minutes,approved_by)
SELECT '88888888-8888-8888-8888-888888888888','11111111-1111-1111-1111-111111111111',
 id,updated_at,repeat('a',64),'Stale',1,1,'Owner'
FROM public.blog_posts WHERE slug='selar';
DO $$ BEGIN
 BEGIN
  PERFORM public.apply_approved_baci_blog_correction('88888888-8888-8888-8888-888888888888');
  RAISE EXCEPTION 'Stale live content overwritten';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
UPDATE baci_blog_release_private.publishers SET enabled=false;
DO $$ BEGIN
 BEGIN
  PERFORM public.apply_approved_baci_blog_correction('88888888-8888-8888-8888-888888888888');
  RAISE EXCEPTION 'Disabled publisher accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
