-- Catalog assertions for 20261109090000: nobody but the owner may call the
-- saved-token purge directly, and its BEFORE DELETE row trigger is still
-- installed and enabled.
DO $$
DECLARE
  routine regprocedure :=
    'piggyvest_primary_card.purge_saved_tokens_on_customer_deletion()'::regprocedure;
  role_name name;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) grant_entry
    WHERE p.oid = routine AND grant_entry.grantee <> p.proowner
      AND grant_entry.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Saved-token purge grants execution to a non-owner';
  END IF;
  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role',
    'primary_bank_signed_intake', 'primary_bank_inbox_worker',
    'primary_card_authorizer', 'primary_card_evidence',
    'primary_card_custody_evidence'
  ]::name[] LOOP
    -- Nested IFs: SQL AND does not guarantee short-circuit evaluation, and
    -- has_function_privilege raises for a role that does not exist.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      IF pg_catalog.has_function_privilege(role_name, routine, 'EXECUTE') THEN
        RAISE EXCEPTION 'Role % can execute the saved-token purge', role_name;
      END IF;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.customers'::regclass
      AND t.tgname = 'primary_card_purge_saved_tokens_on_customer_deletion'
      AND t.tgfoid = routine
      AND t.tgenabled IN ('O', 'A')
      -- FOR EACH ROW (1), BEFORE (2), DELETE (8); not INSERT (4) or UPDATE (16).
      AND (t.tgtype::integer & 31) = 11
  ) THEN
    RAISE EXCEPTION 'Saved-token purge trigger is missing or disabled';
  END IF;
END $$;

-- Behavioural check: the purge still fires for a role that can no longer
-- EXECUTE it, because PostgreSQL checks trigger-function EXECUTE only when
-- the trigger is created. A session-scoped temp table carries the same
-- trigger and is deleted from as `authenticated`; any permission error fails
-- here. The temp table disappears with the session. The token nulling itself
-- is covered by primary-wallet-account-deletion-detach.integration.sql.
CREATE TEMP TABLE purge_trigger_probe (id uuid PRIMARY KEY);
CREATE TRIGGER purge_trigger_probe_before_delete
  BEFORE DELETE ON purge_trigger_probe
  FOR EACH ROW EXECUTE FUNCTION
    piggyvest_primary_card.purge_saved_tokens_on_customer_deletion();
INSERT INTO purge_trigger_probe VALUES ('00000000-0000-4000-8000-00000000c0de');
GRANT SELECT, DELETE ON purge_trigger_probe TO authenticated;
SET ROLE authenticated;
DELETE FROM purge_trigger_probe;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM purge_trigger_probe) THEN
    RAISE EXCEPTION 'Saved-token purge trigger blocked the delete';
  END IF;
END $$;
