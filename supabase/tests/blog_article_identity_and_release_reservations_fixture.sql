-- Disposable-only minimal schema fixture for standalone execution of
-- supabase/tests/run-blog-release-reservations.sh. Not included in replay-registry.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'role',
    pg_catalog.current_setting('request.jwt.claim.role', true)
  )
$$;

CREATE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '')
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), auth.role()
  TO anon, authenticated, service_role;

CREATE TABLE public.merchants (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  email text,
  business_name text,
  slug text
);

CREATE TABLE public.staff_members (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  name text,
  role text,
  status text NOT NULL DEFAULT 'active',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION public.check_staff_permission(
  p_user_id uuid,
  p_merchant_id uuid,
  p_resource text,
  p_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user_id = (SELECT auth.uid()) AND (
    EXISTS (
      SELECT 1 FROM public.merchants
      WHERE id = p_merchant_id AND user_id = p_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.staff_members
      WHERE user_id = p_user_id
        AND merchant_id = p_merchant_id
        AND status = 'active'
        AND (permissions -> p_resource ->> p_action)::boolean IS TRUE
    )
  )
$$;

GRANT EXECUTE ON FUNCTION public.check_staff_permission(uuid, uuid, text, text)
  TO anon, authenticated, service_role;

CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text DEFAULT 'active'
);

CREATE TABLE public.categories (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  slug text
);

CREATE TABLE public.blog_posts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  merchant_id uuid REFERENCES public.merchants(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL,
  content text NOT NULL,
  excerpt text,
  featured_image_url text,
  featured_image_width integer,
  featured_image_height integer,
  featured_image_variants jsonb DEFAULT '{}'::jsonb,
  featured_image_alt text,
  category text,
  tags text[] DEFAULT '{}'::text[],
  keywords text[] DEFAULT '{}'::text[],
  author_name text NOT NULL DEFAULT 'Editorial',
  author_title text,
  author_image_url text,
  author_bio text,
  status text DEFAULT 'draft',
  seo_title text,
  seo_description text,
  focus_keyword text,
  word_count integer DEFAULT 0,
  reading_time_minutes integer,
  published_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_platform_post boolean DEFAULT false,
  classification_revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  cluster_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  guide_scope text,
  guide_kind text,
  applicable_brands text[] NOT NULL DEFAULT '{}'::text[],
  metadata_source text NOT NULL DEFAULT 'unverified',
  metadata_status text NOT NULL DEFAULT 'unverified',
  metadata_contract_version integer NOT NULL DEFAULT 2,
  metadata_source_revision text,
  metadata_content_hash text,
  metadata_verified_at timestamptz,
  metadata_verified_by text,
  CONSTRAINT blog_posts_merchant_id_slug_key UNIQUE (merchant_id, slug),
  CONSTRAINT blog_posts_status_check CHECK (
    status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text, 'scheduled'::text])
  ),
  CONSTRAINT chk_platform_post_merchant CHECK (
    (is_platform_post AND merchant_id IS NULL)
    OR (NOT is_platform_post AND merchant_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX blog_posts_id_merchant_classification_key
  ON public.blog_posts (id, merchant_id);

CREATE TABLE public.blog_post_products (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  blog_post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'primary',
  position integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Mirror 20261025162653 & 20261104000000 triggers on public.blog_posts
CREATE FUNCTION private.set_blog_post_classification_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.classification_revision := pg_catalog.gen_random_uuid();
  ELSIF ROW(NEW.title, NEW.content, NEW.category, NEW.excerpt, NEW.tags, NEW.keywords)
      IS DISTINCT FROM ROW(OLD.title, OLD.content, OLD.category, OLD.excerpt, OLD.tags, OLD.keywords) THEN
    NEW.classification_revision := pg_catalog.gen_random_uuid();
  ELSE
    NEW.classification_revision := OLD.classification_revision;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_blog_post_classification_revision
  BEFORE INSERT OR UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION private.set_blog_post_classification_revision();

CREATE FUNCTION public.blog_posts_stale_on_content_change_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.metadata_status = 'verified'
     AND NEW.metadata_status = 'verified'
     AND (
       OLD.title IS DISTINCT FROM NEW.title
       OR OLD.content IS DISTINCT FROM NEW.content
       OR OLD.excerpt IS DISTINCT FROM NEW.excerpt
       OR OLD.category IS DISTINCT FROM NEW.category
       OR OLD.tags IS DISTINCT FROM NEW.tags
       OR OLD.keywords IS DISTINCT FROM NEW.keywords
     )
     AND OLD.metadata_verified_at IS NOT DISTINCT FROM NEW.metadata_verified_at
     AND OLD.metadata_source_revision IS NOT DISTINCT FROM NEW.metadata_source_revision THEN
    NEW.metadata_status := 'stale';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blog_posts_stale_on_content_change
  BEFORE INSERT OR UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.blog_posts_stale_on_content_change_trigger();

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_posts TO authenticated, service_role;
GRANT SELECT ON public.blog_posts TO anon;

CREATE POLICY blog_posts_authenticated_policy
  ON public.blog_posts FOR ALL TO authenticated
  USING (public.check_staff_permission(auth.uid(), merchant_id, 'marketing', 'edit'))
  WITH CHECK (public.check_staff_permission(auth.uid(), merchant_id, 'marketing', 'edit'));

-- Wrapper matching 20261009090000_verify_merchant_blog_media_atomic.sql signature
-- so the suite tests mutate_merchant_blog_post_with_product_links against _base.
CREATE FUNCTION public.mutate_merchant_blog_post_with_product_links(
  p_post_id uuid,
  p_merchant_id uuid,
  p_post_data jsonb,
  p_product_ids uuid[] DEFAULT NULL,
  p_media_paths text[] DEFAULT '{}'
)
RETURNS TABLE (
  id uuid,
  merchant_id uuid,
  title text,
  slug text,
  content text,
  excerpt text,
  category text,
  featured_image_url text,
  status text,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.mutate_merchant_blog_post_with_product_links_base(
    p_post_id,
    p_merchant_id,
    p_post_data,
    p_product_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mutate_merchant_blog_post_with_product_links(uuid, uuid, jsonb, uuid[], text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_merchant_blog_post_with_product_links(uuid, uuid, jsonb, uuid[], text[])
  TO authenticated;
