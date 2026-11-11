-- Run only on an empty disposable PostgreSQL database with psql -X.
-- Set -v before_patch=1 to verify the same assertions fail on the old policy.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('fixture.actor', true), '')::uuid $$;
-- Fixture models the existing tenant-aware helper; this test exercises RLS composition.
CREATE FUNCTION public.check_staff_permission(uuid, uuid, text, text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT $2 = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid AND $3 = 'marketing'
    AND ($1 = '00000000-0000-0000-0000-000000000001'::uuid
      OR ($1 = '00000000-0000-0000-0000-000000000002'::uuid AND $4 = 'edit'))
$$;
CREATE TABLE public.blog_posts (
  id int PRIMARY KEY, merchant_id uuid, status text, published_at timestamptz
);
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.blog_posts TO anon, authenticated;
CREATE POLICY "Unified view access for blog posts" ON public.blog_posts FOR SELECT USING (true);
INSERT INTO public.blog_posts VALUES
  (1,'6b5cb8a4-5575-456c-b936-8cdfae30db74','published',now() - interval '1 hour'),
  (2,'6b5cb8a4-5575-456c-b936-8cdfae30db74','draft',NULL),
  (3,'6b5cb8a4-5575-456c-b936-8cdfae30db74','scheduled',now() + interval '1 hour'),
  (4,'6b5cb8a4-5575-456c-b936-8cdfae30db74','archived',now()),
  (5,'6b5cb8a4-5575-456c-b936-8cdfae30db74','published',now() + interval '1 hour'),
  (6,'6b5cb8a4-5575-456c-b936-8cdfae30db74','published',NULL),
  (7,'00000000-0000-0000-0000-000000000007','draft',NULL),
  (8,NULL,'published',now());
\if :{?before_patch}
\else
\ir ../20261111044550_restrict_ogabassey_blog_draft_reads.sql
\endif
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF ARRAY(SELECT id FROM public.blog_posts ORDER BY id) <> ARRAY[1,7,8] THEN
    RAISE EXCEPTION 'anonymous visibility regression';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
SET LOCAL fixture.actor = '00000000-0000-0000-0000-000000000003';
DO $$ BEGIN
  IF ARRAY(SELECT id FROM public.blog_posts ORDER BY id) <> ARRAY[1,7,8] THEN
    RAISE EXCEPTION 'unrelated authenticated visibility regression';
  END IF;
END $$;
SET LOCAL fixture.actor = '00000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_posts) <> 8 THEN
    RAISE EXCEPTION 'owner lost editorial access';
  END IF;
END $$;
SET LOCAL fixture.actor = '00000000-0000-0000-0000-000000000002';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_posts) <> 8 THEN
    RAISE EXCEPTION 'editor without view grant lost mutation-related visibility';
  END IF;
END $$;
ROLLBACK;
