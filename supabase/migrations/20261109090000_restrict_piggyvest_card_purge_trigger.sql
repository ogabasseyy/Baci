-- The saved-token purge runs only from its BEFORE DELETE trigger on
-- public.customers. PostgreSQL checks EXECUTE on a trigger function when the
-- trigger is created, not when it fires, so revoking direct execution keeps
-- the purge working while removing an unneeded SECURITY DEFINER entry point.
-- 20261108153000 restricted the other card internals but missed this one.
REVOKE EXECUTE ON FUNCTION
  piggyvest_primary_card.purge_saved_tokens_on_customer_deletion()
  FROM PUBLIC, anon, authenticated;
