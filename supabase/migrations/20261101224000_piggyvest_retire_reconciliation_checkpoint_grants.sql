-- Main reconciles against the bound transaction-status record. Its retired
-- listing fallback must not expand the restricted evidence worker's grants.
-- Preserve historical functions and rows; remove only their invocation rights.
BEGIN;
REVOKE ALL ON FUNCTION
  piggyvest_primary.claim_savings_reconciliation_checkpoint(uuid,text,uuid),
  piggyvest_primary.save_savings_reconciliation_checkpoint(uuid,text,jsonb),
  piggyvest_primary.finish_savings_reconciliation_checkpoint(uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_evidence;
COMMIT;
