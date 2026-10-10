BEGIN;
-- Follow-up to 092700 (Codex P1): the FK rewrite list omitted
-- inflow_receipts.wallet_transaction_id, whose original NO ACTION
-- constraint still aborts delete_current_storefront_account() for any
-- customer with a primary bank inflow (the wallet transaction cascade
-- hits the receipt first). Detach the link and retain the receipt:
-- inflow evidence keeps its provider/digest/identity fields with only
-- the local transaction pointer nulled. Full audit of the PR's FKs to
-- deletion-cascaded public tables (customers, savings goals, wallet
-- transactions): this was the sole remaining NO ACTION gap; merchant
-- links need no action (merchants are never deleted) and every other
-- customer/goal/transaction link is already SET NULL or intentionally
-- cascading (goal_wallet_intents).
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT constraint_entry.conname INTO constraint_name
  FROM pg_catalog.pg_constraint constraint_entry
  JOIN pg_catalog.pg_class referencing
    ON referencing.oid = constraint_entry.conrelid
  JOIN pg_catalog.pg_namespace referencing_schema
    ON referencing_schema.oid = referencing.relnamespace
  JOIN pg_catalog.pg_class referenced
    ON referenced.oid = constraint_entry.confrelid
  JOIN pg_catalog.pg_namespace referenced_schema
    ON referenced_schema.oid = referenced.relnamespace
  WHERE constraint_entry.contype = 'f'
    AND referencing_schema.nspname = 'piggyvest_primary'
    AND referencing.relname = 'inflow_receipts'
    AND referenced_schema.nspname = 'public'
    AND referenced.relname = 'customer_wallet_transactions'
    AND constraint_entry.conkey = ARRAY[(
      SELECT attnum FROM pg_catalog.pg_attribute
      WHERE attrelid = referencing.oid AND attname = 'wallet_transaction_id'
    )];
  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'missing FK inflow_receipts.wallet_transaction_id';
  END IF;
  EXECUTE format(
    'ALTER TABLE piggyvest_primary.inflow_receipts DROP CONSTRAINT %I',
    constraint_name
  );
  ALTER TABLE piggyvest_primary.inflow_receipts
    ADD CONSTRAINT inflow_receipts_wallet_transaction_id_account_deletion
    FOREIGN KEY (wallet_transaction_id)
    REFERENCES public.customer_wallet_transactions(id) ON DELETE SET NULL;
END $$;
ALTER TABLE piggyvest_primary.inflow_receipts
  ALTER COLUMN wallet_transaction_id DROP NOT NULL;
COMMIT;
