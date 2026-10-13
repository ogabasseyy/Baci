-- Execute only against a disposable local PostgreSQL instance with:
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/public_storefront_domain_resolution.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.merchants') IS NOT NULL
    OR to_regclass('public.domains') IS NOT NULL
  THEN
    RAISE EXCEPTION
      'public_storefront_domain_resolution.sql requires an empty disposable database';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$$;

CREATE TABLE public.merchants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  is_published boolean NOT NULL DEFAULT false
);
CREATE TABLE public.domains (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  domain text NOT NULL,
  domain_type text NOT NULL,
  status text NOT NULL,
  is_primary boolean,
  verified_at timestamptz
);
CREATE INDEX idx_domains_active_lower_domain
ON public.domains (pg_catalog.lower(domain))
WHERE status = 'active';
CREATE UNIQUE INDEX domains_one_primary_per_merchant_idx
ON public.domains (merchant_id)
WHERE is_primary = true;
CREATE UNIQUE INDEX domains_active_normalized_domain_uidx
ON public.domains (pg_catalog.lower(pg_catalog.btrim(domain)))
WHERE status = 'active';
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchants, public.domains FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.test_assert(condition boolean, label text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF NOT COALESCE(condition, false) THEN
    RAISE EXCEPTION 'assertion failed: %', label;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.test_assert(boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_assert(boolean, text) TO anon, authenticated;

CREATE FUNCTION public.test_assert_permission_denied(statement text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'expected permission denied for %', statement;
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.test_assert_permission_denied(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_assert_permission_denied(text) TO anon, authenticated;

\ir ../migrations/20260926120000_public_storefront_domain_resolution.sql

INSERT INTO public.merchants (id, slug, is_published) VALUES
  ('00000000-0000-0000-0000-000000000001', 'alpha', false),
  ('00000000-0000-0000-0000-000000000002', 'beta', false),
  ('00000000-0000-0000-0000-000000000003', 'gamma', true);
INSERT INTO public.domains (
  id, merchant_id, domain, domain_type, status, is_primary, verified_at
) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'alpha.primary.test', 'custom', 'active', true, NULL),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'alpha.extra.test', 'purchased', 'active', false, NULL),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'alpha.inactive.test', 'custom', 'pending', false, NULL),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'alpha.wrong-type.test', 'subdomain', 'active', false, NULL),
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000002', 'beta.sole.test', 'custom', 'active', NULL, NULL),
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000003', 'gamma.one.test', 'custom', 'active', false, NULL),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000003', 'gamma.two.test', 'purchased', 'active', false, NULL),
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000001', 'MiXeD.Stored.Test', 'custom', 'active', false, NULL);

SET ROLE anon;
SELECT public.test_assert(
  public.resolve_storefront_domain_slug('alpha.primary.test') = 'alpha',
  'active unverified domain resolves an unpublished merchant by exact key'
);
SELECT public.test_assert(
  public.resolve_storefront_domain_slug('alpha.inactive.test') IS NULL,
  'inactive domain does not resolve'
);
SELECT public.test_assert(
  public.resolve_storefront_domain_slug('mixed.stored.test') IS NULL,
  'stored domain matching remains exact after input normalization'
);
SELECT public.test_assert(
  public.resolve_storefront_domain_slug('primary.test') IS NULL,
  'domain matching is exact rather than partial'
);
SELECT public.test_assert(
  public.resolve_storefront_domain_slug(NULL) IS NULL
  AND public.resolve_storefront_domain_slug('') IS NULL
  AND public.resolve_storefront_domain_slug(repeat('x', 255)) IS NULL,
  'domain input bounds return null'
);
SELECT public.test_assert(
  public.resolve_storefront_custom_domain(' ALPHA ') = 'alpha.primary.test',
  'eligible primary domain wins'
);
SELECT public.test_assert(
  public.resolve_storefront_custom_domain('beta') = 'beta.sole.test',
  'sole nullable-primary domain resolves'
);
SELECT public.test_assert(
  public.resolve_storefront_custom_domain('gamma') IS NULL,
  'multiple non-primary eligible domains are ambiguous'
);
SELECT public.test_assert(
  public.resolve_storefront_custom_domain('missing') IS NULL,
  'missing merchant does not resolve'
);
SELECT public.test_assert_permission_denied('SELECT domain FROM public.domains');
SELECT public.test_assert_permission_denied('SELECT slug FROM public.merchants');
RESET ROLE;

SET ROLE authenticated;
SELECT public.test_assert(
  public.resolve_storefront_domain_slug('alpha.primary.test') = 'alpha'
  AND public.resolve_storefront_custom_domain('beta') = 'beta.sole.test',
  'authenticated has the same scalar resolver contract'
);
SELECT public.test_assert_permission_denied('SELECT domain FROM public.domains');
SELECT public.test_assert_permission_denied('SELECT slug FROM public.merchants');
RESET ROLE;

SELECT public.test_assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS acl(grantor, grantee, privilege_type, is_grantable)
    WHERE procedure_row.oid IN (
      'public.resolve_storefront_domain_slug(text)'::regprocedure,
      'public.resolve_storefront_custom_domain(text)'::regprocedure
    )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC execution is revoked'
);
SELECT public.test_assert(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = 'public.resolve_storefront_domain_slug(text)'::regprocedure
      AND pg_catalog.pg_get_functiondef(procedure_row.oid)
        LIKE '%SET search_path TO ''''%'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = 'public.resolve_storefront_custom_domain(text)'::regprocedure
      AND pg_catalog.pg_get_functiondef(procedure_row.oid)
        LIKE '%SET search_path TO ''''%'
  ),
  'resolver functions use an empty search path'
);

ROLLBACK;
