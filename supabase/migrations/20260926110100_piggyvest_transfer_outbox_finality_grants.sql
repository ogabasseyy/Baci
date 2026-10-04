DO $$
DECLARE
  restricted_role text;
BEGIN
  FOREACH restricted_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = restricted_role) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.require_piggyvest_transfer_outbox_worker() FROM %I',
        restricted_role
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.require_piggyvest_transfer_outbox_system(text) FROM %I',
        restricted_role
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.protect_piggyvest_scoped_transfer_outbox() FROM %I',
        restricted_role
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.read_piggyvest_transfer_outbox_finality(text, text, text, text, text) FROM %I',
        restricted_role
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.apply_piggyvest_transfer_outbox_finality(text, text, bigint, text, text, text, text, text, text, text, text, text) FROM %I',
        restricted_role
      );
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'piggyvest_staging_ledger_worker') THEN
    GRANT EXECUTE ON FUNCTION public.read_piggyvest_transfer_outbox_finality(text, text, text, text, text)
      TO piggyvest_staging_ledger_worker;
    GRANT EXECUTE ON FUNCTION public.apply_piggyvest_transfer_outbox_finality(text, text, bigint, text, text, text, text, text, text, text, text, text)
      TO piggyvest_staging_ledger_worker;
  END IF;
END;
$$;
