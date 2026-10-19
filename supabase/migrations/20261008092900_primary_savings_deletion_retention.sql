BEGIN;
-- Follow-up to 092700 (Codex P1): CASCADE on the savings goal links
-- deleted the only savings_destinations mapping plus every savings
-- operation and completion proof for funded goals, stranding funds at
-- PiggyVest with no local goal/wallet association. Retain all money
-- evidence with detached (NULL) goal and wallet-transaction links
-- instead; deletion always succeeds and the recovery trail survives.
-- Destinations and completion reviews carry goal_id in their primary
-- key, so they take surrogate keys here; the replacement UNIQUEs keep
-- the reviews ON CONFLICT arbiter valid, and the interest-crosswalk
-- composite FK is re-added onto the destinations UNIQUE (Postgres pins
-- it to the PK index, so it cannot survive the swap in place).
-- goal_wallet_intents keeps CASCADE: its goal_id is PK-bound and
-- update-immutable, it is provisioning-process state rather than money
-- evidence, and the retained destination row keeps the provider wallet
-- mapping. savings_completion_evidence keeps CASCADE on operation_id:
-- operations are now retained, so evidence is retained with them.
DO $$
DECLARE
  spec record;
  constraint_name text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('piggyvest_primary', 'savings_destinations', 'goal_id',
       'public', 'customer_savings_goals', 'id'),
      ('piggyvest_primary', 'savings_operations', 'goal_id',
       'public', 'customer_savings_goals', 'id'),
      ('piggyvest_primary', 'savings_operations', 'wallet_transaction_id',
       'public', 'customer_wallet_transactions', 'id'),
      ('piggyvest_primary', 'savings_completion_reviews', 'goal_id',
       'public', 'customer_savings_goals', 'id')
    ) AS v(table_schema, table_name, column_name,
            ref_schema, ref_table, ref_column)
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
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I(%I) ON DELETE SET NULL',
      spec.table_schema, spec.table_name,
      spec.table_name || '_' || spec.column_name || '_account_deletion',
      spec.column_name, spec.ref_schema, spec.ref_table, spec.ref_column
    );
  END LOOP;
  -- Destinations: the interest-crosswalk composite FK pins the PK index,
  -- so it is dropped and re-added around the swap (the replacement UNIQUE
  -- keeps it valid throughout; MATCH SIMPLE still exempts detached rows).
  SELECT constraint_entry.conname INTO constraint_name
  FROM pg_catalog.pg_constraint constraint_entry
  JOIN pg_catalog.pg_class referencing
    ON referencing.oid = constraint_entry.conrelid
  JOIN pg_catalog.pg_namespace referencing_schema
    ON referencing_schema.oid = referencing.relnamespace
  JOIN pg_catalog.pg_class referenced
    ON referenced.oid = constraint_entry.confrelid
  WHERE constraint_entry.contype = 'f'
    AND referencing_schema.nspname = 'piggyvest_primary'
    AND referencing.relname = 'paid_interest_crosswalks'
    AND referenced.relname = 'savings_destinations';
  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'missing crosswalk destination FK';
  END IF;
  EXECUTE format(
    'ALTER TABLE piggyvest_primary.paid_interest_crosswalks DROP CONSTRAINT %I',
    constraint_name
  );
  ALTER TABLE piggyvest_primary.savings_destinations
    ADD COLUMN id uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL;
  ALTER TABLE piggyvest_primary.savings_destinations
    ADD UNIQUE (integration_id, goal_id);
  SELECT constraint_entry.conname INTO constraint_name
  FROM pg_catalog.pg_constraint constraint_entry
  JOIN pg_catalog.pg_class referencing
    ON referencing.oid = constraint_entry.conrelid
  JOIN pg_catalog.pg_namespace referencing_schema
    ON referencing_schema.oid = referencing.relnamespace
  WHERE constraint_entry.contype = 'p'
    AND referencing_schema.nspname = 'piggyvest_primary'
    AND referencing.relname = 'savings_destinations';
  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'missing PK on savings_destinations';
  END IF;
  EXECUTE format(
    'ALTER TABLE piggyvest_primary.savings_destinations DROP CONSTRAINT %I, ADD PRIMARY KEY (id)',
    constraint_name
  );
  ALTER TABLE piggyvest_primary.paid_interest_crosswalks
    ADD FOREIGN KEY (integration_id, goal_id)
    REFERENCES piggyvest_primary.savings_destinations (integration_id, goal_id);
  -- Reviews: no incoming FKs, only the ON CONFLICT arbiter to preserve.
  ALTER TABLE piggyvest_primary.savings_completion_reviews
    ADD COLUMN id uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL;
  ALTER TABLE piggyvest_primary.savings_completion_reviews
    ADD UNIQUE (goal_id);
  SELECT constraint_entry.conname INTO constraint_name
  FROM pg_catalog.pg_constraint constraint_entry
  JOIN pg_catalog.pg_class referencing
    ON referencing.oid = constraint_entry.conrelid
  JOIN pg_catalog.pg_namespace referencing_schema
    ON referencing_schema.oid = referencing.relnamespace
  WHERE constraint_entry.contype = 'p'
    AND referencing_schema.nspname = 'piggyvest_primary'
    AND referencing.relname = 'savings_completion_reviews';
  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'missing PK on savings_completion_reviews';
  END IF;
  EXECUTE format(
    'ALTER TABLE piggyvest_primary.savings_completion_reviews DROP CONSTRAINT %I, ADD PRIMARY KEY (id)',
    constraint_name
  );
END $$;
ALTER TABLE piggyvest_primary.savings_destinations
  ALTER COLUMN goal_id DROP NOT NULL;
ALTER TABLE piggyvest_primary.savings_operations
  ALTER COLUMN goal_id DROP NOT NULL,
  ALTER COLUMN wallet_transaction_id DROP NOT NULL;
ALTER TABLE piggyvest_primary.savings_completion_reviews
  ALTER COLUMN goal_id DROP NOT NULL;
COMMIT;
