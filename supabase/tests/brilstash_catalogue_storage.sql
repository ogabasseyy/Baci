-- Disposable database fixture only. Run with psql -v ON_ERROR_STOP=1.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
\ir ../migrations/20261119010141_brilstash_catalogue_storage.sql

INSERT INTO public.merchants VALUES ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');
INSERT INTO private.brilstash_installations (id, merchant_id, partner_identity)
VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'partner-one'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000002', 'partner-two');
INSERT INTO private.brilstash_generations
  (id, installation_id, catalogue_revision, source_read_at, payload, payload_digest)
VALUES ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101',
  0, now(), '[{"external_id":"test-one"}]', repeat('a', 64));

DO $$
DECLARE
  install_one uuid := '00000000-0000-4000-8000-000000000101';
  install_two uuid := '00000000-0000-4000-8000-000000000102';
  generation_one uuid := '00000000-0000-4000-8000-000000000201';
  merchant_two uuid := '00000000-0000-4000-8000-000000000002';
  relation_name text;
  app_role text;
BEGIN
  UPDATE private.brilstash_installations SET retired_at = now() WHERE id = install_one;
  UPDATE private.brilstash_installations SET activated_at = now() WHERE id = install_two;
  BEGIN
    UPDATE private.brilstash_installations SET activated_at = NULL WHERE id = install_two;
    RAISE EXCEPTION 'activation history was cleared';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO private.brilstash_installations (merchant_id, partner_identity)
    VALUES (merchant_two, 'partner-one');
    RAISE EXCEPTION 'retired binding was reused';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE private.brilstash_installations SET partner_identity = 'other' WHERE id = install_one;
    RAISE EXCEPTION 'binding was reassigned';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM private.brilstash_installations WHERE id = install_two;
    RAISE EXCEPTION 'binding was deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE private.brilstash_installations SET active_generation_id = generation_one WHERE id = install_two;
    RAISE EXCEPTION 'cross-tenant generation accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE private.brilstash_generations SET payload = '[]' WHERE id = generation_one;
    RAISE EXCEPTION 'generation was overwritten';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  FOREACH relation_name IN ARRAY ARRAY[
    'private.brilstash_installations', 'private.brilstash_generations',
    'private.brilstash_builder_entitlements', 'private.brilstash_credentials'
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = relation_name::regclass) THEN
      RAISE EXCEPTION 'RLS unavailable on %', relation_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy
      WHERE polrelid = relation_name::regclass AND polname = 'brilstash_no_direct_access'
    ) THEN
      RAISE EXCEPTION 'direct-access RLS policy unavailable on %', relation_name;
    END IF;
    FOREACH app_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_table_privilege(app_role, relation_name, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') THEN
        RAISE EXCEPTION '% has direct access to %', app_role, relation_name;
      END IF;
    END LOOP;
  END LOOP;
END $$;
ROLLBACK;
