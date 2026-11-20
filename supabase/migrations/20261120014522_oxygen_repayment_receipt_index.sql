-- disable-transaction
-- Keep writes available during the index builds. Recover only interrupted
-- builds whose definitions match exactly.
DO $$
DECLARE
  spec record;
  existing record;
  expected text;
BEGIN
  FOR spec IN
    SELECT *
    FROM (VALUES
      ('oxygen_callback_repayment_receipts_idx', 'callback_inbox',
       $index$(partner_reference, environment, (lower(event->>'bookedLoanReference')), received_at DESC, id)
       WHERE event->>'kind' = 'transaction'
         AND deduplication_key = 'transaction-loan_repayment:' || (event->>'transactionReference')$index$),
      ('oxygen_state_canonical_booking_idx', 'provider_states',
       $index$((lower(state->>'bookingReference')))
       WHERE state->>'bookingReference' IS NOT NULL$index$)
    ) AS specs(index_name, table_name, columns_and_predicate)
  LOOP
    SELECT i.indrelid, i.indisunique, i.indisvalid, i.indisready,
      substring(pg_catalog.pg_get_indexdef(i.indexrelid) FROM ' USING .*$') AS definition
      INTO existing
    FROM pg_catalog.pg_index AS i
    WHERE i.indexrelid = pg_catalog.to_regclass(format('oxygen_private.%I', spec.index_name));
    IF NOT FOUND THEN CONTINUE; END IF;

    -- Compare definitions from the currently running engine. Only the
    -- temporary table and index names differ.
    EXECUTE format('CREATE TEMP TABLE oxygen_repayment_index_shape (LIKE oxygen_private.%I) ON COMMIT DROP',
      spec.table_name);
    EXECUTE format('CREATE INDEX oxygen_repayment_index_expected_shape ON pg_temp.oxygen_repayment_index_shape %s',
      spec.columns_and_predicate);
    SELECT substring(pg_catalog.pg_get_indexdef(
      'pg_temp.oxygen_repayment_index_expected_shape'::regclass
    ) FROM ' USING .*$') INTO expected;
    DROP TABLE pg_temp.oxygen_repayment_index_shape;

    IF existing.indrelid <> pg_catalog.to_regclass(format('oxygen_private.%I', spec.table_name))
      OR existing.indisunique OR expected IS NULL
      OR existing.definition IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'Oxygen repayment index % has an unexpected definition', spec.index_name;
    END IF;
    IF NOT existing.indisvalid OR NOT existing.indisready THEN
      PERFORM pg_catalog.set_config('lock_timeout', '2s', true);
      EXECUTE format('DROP INDEX oxygen_private.%I', spec.index_name);
    END IF;
  END LOOP;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS oxygen_callback_repayment_receipts_idx
  ON oxygen_private.callback_inbox (
    partner_reference, environment, (lower(event->>'bookedLoanReference')), received_at DESC, id
  )
  WHERE event->>'kind' = 'transaction'
    AND deduplication_key = 'transaction-loan_repayment:' || (event->>'transactionReference');

CREATE INDEX CONCURRENTLY IF NOT EXISTS oxygen_state_canonical_booking_idx
  ON oxygen_private.provider_states ((lower(state->>'bookingReference')))
  WHERE state->>'bookingReference' IS NOT NULL;

DO $$ BEGIN
  IF (
    SELECT count(*) FROM pg_catalog.pg_index AS i
    WHERE i.indexrelid IN (
      pg_catalog.to_regclass('oxygen_private.oxygen_callback_repayment_receipts_idx'),
      pg_catalog.to_regclass('oxygen_private.oxygen_state_canonical_booking_idx')
    )
      AND i.indisvalid AND i.indisready
  ) <> 2 THEN
    RAISE EXCEPTION 'An Oxygen repayment index is missing or invalid';
  END IF;
END $$;
