-- Run only in an isolated empty database; migrations/test data never touch production.
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
CREATE FUNCTION private.has_platform_admin_permission_v1(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 = '00000000-0000-4000-8000-000000000001'::uuid AND $2 = 'analytics.read' $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY, slug text);
CREATE TABLE public.imei_lookups(id uuid PRIMARY KEY,merchant_id uuid,imei_hash text,status text,tier text,cached_response jsonb,created_at timestamptz DEFAULT now() - interval '1 minute');
