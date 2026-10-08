-- Regression test for 20261007120000: the outbox claims table must carry a
-- valid, ready btree index on authorization_id so parent authorization
-- updates/deletes stay index-backed as submission history grows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_state
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_state.indexrelid
    JOIN pg_catalog.pg_class AS table_class
      ON table_class.oid = index_state.indrelid
    JOIN pg_catalog.pg_namespace AS table_schema
      ON table_schema.oid = table_class.relnamespace
    JOIN pg_catalog.pg_attribute AS indexed_column
      ON indexed_column.attrelid = table_class.oid
      AND indexed_column.attname = 'authorization_id'
    JOIN pg_catalog.pg_am AS index_method
      ON index_method.oid = index_class.relam
    WHERE table_schema.nspname = 'public'
      AND table_class.relname = 'piggyvest_transfer_outbox_submission_claims'
      AND index_class.relname = 'piggyvest_transfer_outbox_claims_authorization_idx'
      AND index_state.indisvalid
      AND index_state.indisready
      AND index_method.amname = 'btree'
      AND index_state.indpred IS NULL
      AND index_state.indnatts = 1
      AND index_state.indkey[0] = indexed_column.attnum
  ) THEN
    RAISE EXCEPTION 'piggyvest_transfer_outbox_submission_claims.authorization_id is not backed by a valid ready index';
  END IF;
END;
$$;
