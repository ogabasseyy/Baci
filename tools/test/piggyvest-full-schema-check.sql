BEGIN;
CREATE ROLE piggyvest_full_probe NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEROLE NOCREATEDB;
DO $$ BEGIN
  EXECUTE format('GRANT piggyvest_full_probe TO %I WITH INHERIT FALSE, SET TRUE', current_user);
END $$;
DO $$
DECLARE table_name text; table_id regclass;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['public.customer_savings_goals','public.customers','public.products','public.product_variants','public.orders'] LOOP
    table_id:=to_regclass(table_name);
    IF table_id IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=table_id AND relrowsecurity) THEN
      RAISE EXCEPTION 'Real public table missing or RLS disabled: %',table_name;
    END IF;
  END LOOP;
  IF to_regprocedure('piggyvest_purchase_preparation.read_current_recovery(uuid,uuid,uuid,uuid,text,uuid,uuid)') IS NULL
    OR to_regprocedure('piggyvest_collection_reconciliation.read(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Current PiggyVest recovery migrations missing';
  END IF;
END $$;
\ir piggyvest-private-schema-check.sql
ROLLBACK;
