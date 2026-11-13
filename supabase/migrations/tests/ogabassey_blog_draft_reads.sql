-- Runs after chronological replay against the actual schema and RLS helpers.
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('b3f20000-0000-4000-8000-000000000001', 'blog-privacy-owner@example.invalid'),
  ('b3f20000-0000-4000-8000-000000000002', 'blog-privacy-create@example.invalid'),
  ('b3f20000-0000-4000-8000-000000000004', 'blog-privacy-editor@example.invalid');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.merchants (id, email, user_id)
VALUES ('6b5cb8a4-5575-456c-b936-8cdfae30db74', 'blog-privacy-owner@example.invalid',
        'b3f20000-0000-4000-8000-000000000001');
INSERT INTO public.staff_members (merchant_id, user_id, email, status, permissions) VALUES
  ('6b5cb8a4-5575-456c-b936-8cdfae30db74', 'b3f20000-0000-4000-8000-000000000002',
   'blog-privacy-create@example.invalid', 'active',
   '{"marketing":{"create":true,"view":false,"edit":false,"delete":false}}'),
  ('6b5cb8a4-5575-456c-b936-8cdfae30db74', 'b3f20000-0000-4000-8000-000000000004',
   'blog-privacy-editor@example.invalid', 'active', '{"marketing":{"edit":true}}');
INSERT INTO public.blog_posts (merchant_id, title, slug, content, author_name, status, published_at)
SELECT '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'Privacy fixture',
       'privacy-fixture-' || state, 'Synthetic content', 'Fixture author', state,
       CASE state
         WHEN 'published' THEN now() - interval '1 hour'
         WHEN 'scheduled' THEN now() + interval '1 hour'
       END
FROM unnest(ARRAY['draft', 'archived', 'scheduled', 'published']) AS state;
INSERT INTO public.blog_posts (merchant_id, title, slug, content, author_name, status, published_at)
VALUES ('6b5cb8a4-5575-456c-b936-8cdfae30db74', 'Future fixture', 'privacy-fixture-future',
        'Synthetic content', 'Fixture author', 'published', now() + interval '1 hour');
INSERT INTO public.merchants (id, email)
VALUES ('b3f20000-0000-4000-8000-000000000003', 'blog-privacy-control@example.invalid');
INSERT INTO public.blog_posts (merchant_id, title, slug, content, author_name, status)
VALUES ('b3f20000-0000-4000-8000-000000000003', 'Other merchant control',
        'other-tenant-privacy-control', 'Synthetic content', 'Fixture author', 'draft');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
DO $$ BEGIN
  IF ARRAY(SELECT slug FROM public.blog_posts WHERE slug LIKE 'privacy-fixture-%' ORDER BY slug)
     <> ARRAY['privacy-fixture-published'] THEN
    RAISE EXCEPTION 'anon must only see the published fixture';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blog_posts
    WHERE merchant_id = 'b3f20000-0000-4000-8000-000000000003'
      AND slug = 'other-tenant-privacy-control') THEN
    RAISE EXCEPTION 'anon visibility for other tenants must remain unchanged';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'b3f20000-0000-4000-8000-000000000002', true);
DO $$ BEGIN
  IF ARRAY(SELECT slug FROM public.blog_posts WHERE slug LIKE 'privacy-fixture-%' ORDER BY slug)
     <> ARRAY['privacy-fixture-published'] THEN
    RAISE EXCEPTION 'create-only staff must only see the published fixture';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blog_posts
    WHERE merchant_id = 'b3f20000-0000-4000-8000-000000000003'
      AND slug = 'other-tenant-privacy-control') THEN
    RAISE EXCEPTION 'authenticated visibility for other tenants must remain unchanged';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', 'b3f20000-0000-4000-8000-000000000001', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_posts WHERE slug LIKE 'privacy-fixture-%') <> 5 THEN
    RAISE EXCEPTION 'merchant owner must retain editorial visibility';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', 'b3f20000-0000-4000-8000-000000000004', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_posts WHERE slug LIKE 'privacy-fixture-%') <> 5 THEN
    RAISE EXCEPTION 'editor must retain draft visibility';
  END IF;
END $$;
ROLLBACK;
