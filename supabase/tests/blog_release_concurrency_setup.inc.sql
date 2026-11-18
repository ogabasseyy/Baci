-- Multi-session advisory-lock concurrency & retry tests using dblink.
-- Runs cleanly against both standalone disposable fixture and full replay.

\set ON_ERROR_STOP on
\if :{?dblink_password}
\else
\set dblink_password postgres
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'dblink') THEN
    CREATE EXTENSION dblink;
    PERFORM set_config('baci.drop_dblink_after_test', 'true', false);
  ELSE
    PERFORM set_config('baci.drop_dblink_after_test', 'false', false);
  END IF;
END $$;

BEGIN;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DELETE FROM public.merchants
WHERE id = 'd2000000-0000-4000-8000-000000000004';

INSERT INTO public.merchants (id, email, user_id, business_name, slug)
VALUES (
  'd2000000-0000-4000-8000-000000000004',
  'track1-conc@example.invalid',
  NULL,
  'Track1 Concurrency Merchant',
  'track1-conc-merchant'
);

INSERT INTO public.blog_posts (
  id, merchant_id, title, slug, content, author_name, status
) VALUES
  ('d3000000-0000-4000-8000-000000000201', 'd2000000-0000-4000-8000-000000000004', 'Conc Post A', 'conc-post-a', 'Content A', 'Editor', 'draft'),
  ('d3000000-0000-4000-8000-000000000202', 'd2000000-0000-4000-8000-000000000004', 'Conc Post B', 'conc-post-b', 'Content B', 'Editor', 'draft'),
  ('d3000000-0000-4000-8000-000000000203', 'd2000000-0000-4000-8000-000000000004', 'Conc Post C', 'conc-post-c', 'Content C', 'Editor', 'draft');
COMMIT;

SELECT pg_catalog.set_config(
  'baci.conc_connstr',
  CASE
    WHEN pg_catalog.inet_server_addr() IS NULL THEN pg_catalog.format(
      'dbname=%s user=%s',
      '''' || pg_catalog.replace(pg_catalog.replace(pg_catalog.current_database(), E'\\', E'\\\\'), '''', E'\\''') || '''',
      '''' || pg_catalog.replace(pg_catalog.replace(pg_catalog.current_user(), E'\\', E'\\\\'), '''', E'\\''') || ''''
    )
    ELSE pg_catalog.format(
      'host=%s port=%s dbname=%s user=%s password=%s',
      pg_catalog.inet_server_addr(),
      pg_catalog.inet_server_port(),
      '''' || pg_catalog.replace(pg_catalog.replace(pg_catalog.current_database(), E'\\', E'\\\\'), '''', E'\\''') || '''',
      '''' || pg_catalog.replace(pg_catalog.replace(pg_catalog.current_user(), E'\\', E'\\\\'), '''', E'\\''') || '''',
      '''' || pg_catalog.replace(pg_catalog.replace(:'dblink_password', E'\\', E'\\\\'), '''', E'\\''') || ''''
    )
  END,
  false
) IS NOT NULL AS connstr_configured;
