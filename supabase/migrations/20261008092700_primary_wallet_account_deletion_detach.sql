BEGIN;
-- Account deletion previously failed for every onboarded customer:
-- delete_current_storefront_account() hard-deletes public.customers rows
-- (which cascade to savings goals), but the primary-wallet tables link
-- customers and goals with the default NO ACTION action, aborting the
-- delete. Money evidence must be retained, so customer links detach
-- (ON DELETE SET NULL, matching the orders/vtu ledger pattern) while
-- goal-scoped operational rows cascade with their goal (matching the
-- codebase savings pattern). DELETE-immutable interest evidence detaches
-- on both links since it can never cascade. Append-only: earlier
-- migrations are untouched (AGENTS.md).
DO $$
DECLARE
  spec record;
  constraint_name text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- (schema, table, column, ref schema, ref table, ref column, action, nullable)
      ('piggyvest_primary', 'onboarding_intents', 'customer_id',
       'public', 'customers', 'id', 'SET NULL', true),
      ('piggyvest_primary_card', 'operations', 'customer_id',
       'public', 'customers', 'id', 'SET NULL', true),
      ('piggyvest_primary', 'savings_completion_reviews', 'customer_id',
       'public', 'customers', 'id', 'SET NULL', true),
      ('piggyvest_primary', 'paid_interest_receipts', 'customer_id',
       'public', 'customers', 'id', 'SET NULL', true),
      ('piggyvest_primary', 'paid_interest_receipts', 'goal_id',
       'public', 'customer_savings_goals', 'id', 'SET NULL', true),
      ('piggyvest_primary', 'paid_interest_crosswalks', 'goal_id',
       'public', 'customer_savings_goals', 'id', 'SET NULL', true),
      ('piggyvest_primary', 'savings_destinations', 'goal_id',
       'public', 'customer_savings_goals', 'id', 'CASCADE', false),
      ('piggyvest_primary', 'savings_operations', 'goal_id',
       'public', 'customer_savings_goals', 'id', 'CASCADE', false),
      ('piggyvest_primary', 'savings_operations', 'wallet_transaction_id',
       'public', 'customer_wallet_transactions', 'id', 'CASCADE', false),
      ('piggyvest_primary', 'savings_completion_reviews', 'goal_id',
       'public', 'customer_savings_goals', 'id', 'CASCADE', false),
      ('piggyvest_primary', 'savings_completion_evidence', 'operation_id',
       'piggyvest_primary', 'savings_operations', 'id', 'CASCADE', false),
      ('piggyvest_primary', 'goal_wallet_intents', 'goal_id',
       'public', 'customer_savings_goals', 'id', 'CASCADE', false)
    ) AS v(table_schema, table_name, column_name,
            ref_schema, ref_table, ref_column, delete_action, make_nullable)
  LOOP
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
      AND referencing_schema.nspname = spec.table_schema
      AND referencing.relname = spec.table_name
      AND referenced_schema.nspname = spec.ref_schema
      AND referenced.relname = spec.ref_table
      AND constraint_entry.conkey = ARRAY[(
        SELECT attnum FROM pg_catalog.pg_attribute
        WHERE attrelid = referencing.oid AND attname = spec.column_name
      )]
      AND constraint_entry.confkey = ARRAY[(
        SELECT attnum FROM pg_catalog.pg_attribute
        WHERE attrelid = referenced.oid AND attname = spec.ref_column
      )];
    IF constraint_name IS NULL THEN
      RAISE EXCEPTION 'missing FK %.% -> %.%',
        spec.table_name, spec.column_name, spec.ref_table, spec.ref_column;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      spec.table_schema, spec.table_name, constraint_name
    );
    IF spec.make_nullable THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I DROP NOT NULL',
        spec.table_schema, spec.table_name, spec.column_name
      );
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I(%I) ON DELETE %s',
      spec.table_schema, spec.table_name,
      spec.table_name || '_' || spec.column_name || '_account_deletion',
      spec.column_name, spec.ref_schema, spec.ref_table, spec.ref_column,
      -- Action allowlist: the spec above only ever carries these two.
      CASE spec.delete_action WHEN 'SET NULL' THEN 'SET NULL' ELSE 'CASCADE' END
    );
  END LOOP;
END $$;
-- The crosswalk -> savings_destinations composite FK needs no change: the
-- crosswalk goal link detaches above, and a MATCH SIMPLE composite FK with
-- a NULL member is not enforced, so cascaded destinations never strand.
-- The detach itself is an UPDATE, so the two interest immutability guards
-- must permit exactly that transition: every financial field stays frozen,
-- and the customer/goal links may only go from a value to NULL (never
-- re-attached or swapped). Deletes stay fully immutable.
CREATE OR REPLACE FUNCTION piggyvest_primary.guard_interest_crosswalk()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (to_jsonb(NEW)-'enabled'-'goal_id') IS DISTINCT FROM (to_jsonb(OLD)-'enabled'-'goal_id') THEN
    RAISE EXCEPTION 'immutable interest crosswalk' USING ERRCODE='23514';
  END IF;
  IF NEW.goal_id IS DISTINCT FROM OLD.goal_id AND NEW.goal_id IS NOT NULL THEN
    RAISE EXCEPTION 'immutable interest crosswalk' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION piggyvest_primary.guard_interest_receipt_detach()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (to_jsonb(NEW)-'customer_id'-'goal_id') IS DISTINCT FROM (to_jsonb(OLD)-'customer_id'-'goal_id') THEN
    RAISE EXCEPTION 'immutable interest receipt' USING ERRCODE='23514';
  END IF;
  IF (NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL)
    OR (NEW.goal_id IS DISTINCT FROM OLD.goal_id AND NEW.goal_id IS NOT NULL) THEN
    RAISE EXCEPTION 'immutable interest receipt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER primary_interest_receipt_immutable ON piggyvest_primary.paid_interest_receipts;
CREATE TRIGGER primary_interest_receipt_detach_guard BEFORE UPDATE ON piggyvest_primary.paid_interest_receipts
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_interest_receipt_detach();
CREATE TRIGGER primary_interest_receipt_delete_immutable BEFORE DELETE OR TRUNCATE ON piggyvest_primary.paid_interest_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();
REVOKE ALL ON FUNCTION piggyvest_primary.guard_interest_receipt_detach()
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
