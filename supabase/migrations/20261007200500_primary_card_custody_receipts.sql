BEGIN;
CREATE TABLE piggyvest_primary.custody_transaction_aliases (
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  provider_transaction_id text NOT NULL CHECK(octet_length(provider_transaction_id) BETWEEN 1 AND 512),
  receipt_id uuid NOT NULL REFERENCES piggyvest_primary.inflow_receipts(id),
  PRIMARY KEY(integration_id,provider_transaction_id)
);
CREATE INDEX primary_custody_alias_receipt_idx ON piggyvest_primary.custody_transaction_aliases(receipt_id);
ALTER TABLE piggyvest_primary.custody_transaction_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_custody_alias_deny ON piggyvest_primary.custody_transaction_aliases AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary.custody_transaction_aliases FROM PUBLIC,anon,authenticated,service_role,piggyvest_primary_evidence,primary_card_custody_evidence;
INSERT INTO piggyvest_primary.custody_transaction_aliases(integration_id,provider_transaction_id,receipt_id)
  SELECT integration_id,provider_transaction_id,id FROM piggyvest_primary.inflow_receipts;

CREATE TABLE piggyvest_primary_card.settlements (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_primary_card.reservations(operation_id),
  receipt_id uuid NOT NULL REFERENCES piggyvest_primary.inflow_receipts(id),
  proof jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(receipt_id)
);
CREATE INDEX primary_card_settlement_receipt_idx ON piggyvest_primary_card.settlements(receipt_id);
CREATE TABLE piggyvest_primary_card.receivables (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_primary_card.collections(operation_id),
  amount_kobo bigint NOT NULL CHECK(amount_kobo BETWEEN 1 AND 9999999999),
  state text NOT NULL DEFAULT 'awaiting_settlement' CHECK(state='awaiting_settlement')
);
CREATE TABLE piggyvest_primary_card.completion_outbox (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_primary_card.settlements(operation_id),
  state text NOT NULL DEFAULT 'pending' CHECK(state='pending')
);
ALTER TABLE piggyvest_primary_card.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary_card.receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary_card.completion_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_card_settlement_deny ON piggyvest_primary_card.settlements AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_card_receivable_deny ON piggyvest_primary_card.receivables AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_card_completion_deny ON piggyvest_primary_card.completion_outbox AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary_card.settlements,piggyvest_primary_card.receivables,piggyvest_primary_card.completion_outbox FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence,primary_card_transfer_worker,primary_card_custody_evidence;
ALTER TABLE piggyvest_primary_card.operations DROP CONSTRAINT operations_state_check;
ALTER TABLE piggyvest_primary_card.operations ADD CONSTRAINT operations_state_check CHECK(state IN ('reserved','initializing','init_unknown','ready','custody_pending','reconciliation_required','completed'));
COMMIT;
