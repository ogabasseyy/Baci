-- Disposable-only minimal schema for the classification migrations. No live data.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('role',current_setting('request.jwt.claim.role',true))
$$;
GRANT USAGE ON SCHEMA auth, private TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO anon,authenticated,service_role;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users);
CREATE TABLE public.staff_members(user_id uuid,merchant_id uuid,status text,permissions jsonb);
CREATE FUNCTION public.check_staff_permission(p_user_id uuid,p_merchant_id uuid,p_resource text,p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_user_id=(SELECT auth.uid()) AND (
 EXISTS(SELECT 1 FROM public.merchants WHERE id=p_merchant_id AND user_id=p_user_id)
 OR EXISTS(SELECT 1 FROM public.staff_members WHERE user_id=p_user_id AND merchant_id=p_merchant_id
 AND status='active' AND (permissions->p_resource->>p_action)::boolean IS TRUE))
$$;
CREATE TABLE public.merchant_feature_settings(merchant_id uuid PRIMARY KEY REFERENCES public.merchants,blog_enabled boolean);
CREATE TABLE public.blog_posts(
 id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants,title text NOT NULL,content text NOT NULL,
 slug text NOT NULL,category text,excerpt text,tags text[],keywords text[],status text DEFAULT 'draft',
 published_at timestamptz,updated_at timestamptz DEFAULT now(),is_platform_post boolean DEFAULT false,intent text,intent_source text,
 view_count integer NOT NULL DEFAULT 0,
 featured_image_url text,reading_time_minutes integer,search_vector tsvector,
 CONSTRAINT chk_platform_post_merchant CHECK ((is_platform_post AND merchant_id IS NULL) OR (NOT is_platform_post AND merchant_id IS NOT NULL)),
 CONSTRAINT blog_posts_merchant_intent_null CHECK (merchant_id IS NULL OR(intent IS NULL AND intent_source IS NULL))
);
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON public.blog_posts TO authenticated;
CREATE POLICY owner_read ON public.blog_posts FOR SELECT TO authenticated USING(public.check_staff_permission(auth.uid(),merchant_id,'marketing','edit'));
CREATE POLICY owner_update ON public.blog_posts FOR UPDATE TO authenticated USING(public.check_staff_permission(auth.uid(),merchant_id,'marketing','edit')) WITH CHECK(public.check_staff_permission(auth.uid(),merchant_id,'marketing','edit'));
INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,7) i;
INSERT INTO public.merchants VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
INSERT INTO public.merchant_feature_settings SELECT id,true FROM public.merchants;
INSERT INTO public.staff_members VALUES
 ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','active','{"marketing":{"edit":true}}'),
 ('00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','active','{"marketing":{"view":true}}');
INSERT INTO public.blog_posts(id,merchant_id,title,content,slug,category,tags,keywords,status,published_at) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','iPhone guide','<p>Verified article.</p>','iphone-guide','Smartphones','{iPhone}','{Apple}','published',now()),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Draft guide','<p>Draft.</p>','draft-guide','Smartphones','{}','{}','draft',NULL),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Other store','<p>Other.</p>','other','Smartphones','{}','{}','published',now());
INSERT INTO public.blog_posts(id,title,content,slug,is_platform_post) VALUES('20000000-0000-0000-0000-000000000004','Platform','<p>Platform.</p>','platform',true);
CREATE SCHEMA test;
GRANT USAGE ON SCHEMA test TO anon,authenticated,service_role;
CREATE FUNCTION test.assert(p_ok boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'ASSERTION FAILED: %',p_message; END IF; END $$;
CREATE FUNCTION test.denied(p_sql text,p_state text DEFAULT '42501') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=p_state THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'ASSERTION FAILED: request should have failed with %: %',p_state,p_sql;
END $$;
