BEGIN;
DO $$ BEGIN
  IF current_setting('listen_addresses') <> '' THEN RAISE EXCEPTION 'TCP listener enabled'; END IF;
END $$;
\ir piggyvest-private-schema-check.sql
ROLLBACK;
