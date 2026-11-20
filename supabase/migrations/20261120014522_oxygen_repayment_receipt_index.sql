-- disable-transaction
-- Preserve callback writes during the index build. Recover only an interrupted
-- build of this exact index, since IF NOT EXISTS also skips invalid indexes.
DO $$
DECLARE
  existing record;
  expected text;
BEGIN
  SELECT i.indrelid, i.indisunique, i.indisvalid, i.indisready,
    substring(pg_catalog.pg_get_indexdef(i.indexrelid) FROM ' USING .*$') AS definition
    INTO existing
  FROM pg_catalog.pg_index AS i
  WHERE i.indexrelid = pg_catalog.to_regclass('oxygen_private.oxygen_callback_repayment_receipts_idx');
  IF FOUND THEN
    -- Compare definitions emitted by this server, ignoring only the
    -- deliberately different index and table names.
    CREATE TEMP TABLE oxygen_repayment_receipt_index_shape
      (LIKE oxygen_private.callback_inbox) ON COMMIT DROP;
    CREATE INDEX oxygen_repayment_receipt_expected_shape
      ON pg_temp.oxygen_repayment_receipt_index_shape (
        partner_reference, environment, (event->>'bookedLoanReference'), received_at DESC, id
      )
      WHERE event->>'kind' = 'transaction'
        AND deduplication_key = 'transaction-loan_repayment:' || (event->>'transactionReference');
    SELECT substring(pg_catalog.pg_get_indexdef(
      'pg_temp.oxygen_repayment_receipt_expected_shape'::regclass
    ) FROM ' USING .*$') INTO expected;
    IF existing.indrelid <> 'oxygen_private.callback_inbox'::regclass
      OR existing.indisunique OR expected IS NULL
      OR existing.definition IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'Oxygen repayment receipt index has an unexpected definition';
    END IF;
    IF NOT existing.indisvalid OR NOT existing.indisready THEN
      PERFORM pg_catalog.set_config('lock_timeout', '2s', true);
      DROP INDEX oxygen_private.oxygen_callback_repayment_receipts_idx;
    END IF;
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS oxygen_callback_repayment_receipts_idx
  ON oxygen_private.callback_inbox (
    partner_reference, environment, (event->>'bookedLoanReference'), received_at DESC, id
  )
  WHERE event->>'kind' = 'transaction'
    AND deduplication_key = 'transaction-loan_repayment:' || (event->>'transactionReference');

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS i
    WHERE i.indexrelid = pg_catalog.to_regclass('oxygen_private.oxygen_callback_repayment_receipts_idx')
      AND i.indisvalid AND i.indisready
  ) THEN
    RAISE EXCEPTION 'Oxygen repayment receipt index is missing or invalid';
  END IF;
END $$;
