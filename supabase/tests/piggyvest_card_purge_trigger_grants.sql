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
    WHERE p.oid = routine AND grant_entry.grantee = 0
      AND grant_entry.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Saved-token purge still grants PUBLIC execution';
  END IF;
  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role',
    'primary_bank_signed_intake', 'primary_bank_inbox_worker',
    'primary_card_authorizer', 'primary_card_evidence',
    'primary_card_custody_evidence'
  ]::name[] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name)
      AND pg_catalog.has_function_privilege(role_name, routine, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'Role % can execute the saved-token purge', role_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.customers'::regclass
      AND t.tgname = 'primary_card_purge_saved_tokens_on_customer_deletion'
      AND t.tgfoid = routine
      AND t.tgenabled <> 'D'
      -- FOR EACH ROW (1), BEFORE (2), DELETE (8); not INSERT (4) or UPDATE (16).
      AND (t.tgtype::integer & 31) = 11
  ) THEN
    RAISE EXCEPTION 'Saved-token purge trigger is missing or disabled';
  END IF;
END $$;
