-- disable-transaction
-- Preserve callback writes during the index build. Recover only an interrupted
-- build of this exact index, since IF NOT EXISTS also skips invalid indexes.
DO $$
DECLARE
  existing record;
  expected constant text := $definition$CREATE INDEX oxygen_callback_repayment_receipts_idx ON oxygen_private.callback_inbox USING btree (partner_reference, environment, ((event ->> 'bookedLoanReference'::text)), received_at DESC, id) WHERE (((event ->> 'kind'::text) = 'transaction'::text) AND (deduplication_key = ('transaction-loan_repayment:'::text || (event ->> 'transactionReference'::text))))$definition$;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '', true);
  SELECT i.indisvalid, i.indisready, pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
    INTO existing
  FROM pg_catalog.pg_index AS i
  WHERE i.indexrelid = pg_catalog.to_regclass('oxygen_private.oxygen_callback_repayment_receipts_idx');
  IF FOUND THEN
    IF existing.definition IS DISTINCT FROM expected THEN
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
