BEGIN;

CREATE INDEX IF NOT EXISTS primary_savings_reconciliation_checkpoint_integration_idx
  ON piggyvest_primary.savings_reconciliation_checkpoints (integration_id);

COMMIT;
