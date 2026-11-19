-- The saved-token purge runs only from its BEFORE DELETE trigger on
-- public.customers. PostgreSQL checks EXECUTE on a trigger function when the
-- trigger is created, not when it fires, so revoking direct execution keeps
-- the purge working while removing an unneeded SECURITY DEFINER entry point.
-- 20261108153000 restricted the other card internals but missed this one.
REVOKE EXECUTE ON FUNCTION
  piggyvest_primary_card.purge_saved_tokens_on_customer_deletion()
  FROM PUBLIC, anon, authenticated, service_role;

-- Defense in depth: also clear any explicit grant to the PiggyVest capability
-- roles, skipping a role that does not exist in this environment.
DO $$
DECLARE
  role_name name;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'primary_bank_signed_intake', 'primary_bank_inbox_worker',
    'primary_card_authorizer', 'primary_card_evidence',
    'primary_card_custody_evidence'
  ]::name[] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION piggyvest_primary_card.purge_saved_tokens_on_customer_deletion() FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
