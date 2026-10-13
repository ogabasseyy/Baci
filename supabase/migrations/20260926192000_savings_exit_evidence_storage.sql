BEGIN;

CREATE TABLE piggyvest_savings_exit_execution.evidence_scopes (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_staging.integrations(id),
  expected_business_id text NOT NULL,
  authorized_login name NOT NULL CHECK (authorized_login = 'piggyvest_exit_evidence_writer'),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE piggyvest_savings_exit_execution.provider_evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE REFERENCES piggyvest_savings_exit_execution.operations(operation_id),
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  provider_transaction_id text NOT NULL,
  event_id text NOT NULL,
  receipt jsonb NOT NULL,
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (integration_id, provider_transaction_id), UNIQUE (integration_id, event_id)
);
CREATE TABLE piggyvest_savings_exit_execution.accounting_authorities (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_savings_exit_execution.operations(operation_id),
  contract text NOT NULL CHECK (contract IN ('purchase_existing_order', 'external_principal_refund')),
  order_id uuid UNIQUE REFERENCES public.orders(id),
  transaction_id uuid NOT NULL UNIQUE,
  settlement_id uuid NOT NULL UNIQUE,
  platform_fee_kobo bigint NOT NULL CHECK (platform_fee_kobo BETWEEN 0 AND 9007199254740991),
  merchant_amount_kobo bigint NOT NULL CHECK (merchant_amount_kobo BETWEEN 0 AND 9007199254740991),
  provider_fee_kobo bigint NOT NULL CHECK (provider_fee_kobo BETWEEN 0 AND 9007199254740991),
  approved_terms_reference text NOT NULL CHECK (octet_length(approved_terms_reference) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((contract = 'purchase_existing_order' AND order_id IS NOT NULL)
    OR (contract = 'external_principal_refund' AND order_id IS NULL))
);
CREATE TABLE piggyvest_savings_exit_execution.accounting_receipts (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_savings_exit_execution.operations(operation_id),
  projection_id uuid NOT NULL UNIQUE REFERENCES piggyvest_savings_exit_execution.projection_queue(projection_id),
  evidence_id uuid NOT NULL UNIQUE REFERENCES piggyvest_savings_exit_execution.provider_evidence(evidence_id),
  transaction_id uuid NOT NULL UNIQUE REFERENCES public.transactions(id),
  settlement_id uuid NOT NULL UNIQUE REFERENCES piggyvest_savings_ledger.operations(id),
  state text NOT NULL CHECK (state = 'accounted'),
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE piggyvest_savings_exit_execution.evidence_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_savings_exit_execution.provider_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_savings_exit_execution.accounting_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_savings_exit_execution.accounting_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_exit_evidence_scopes ON piggyvest_savings_exit_execution.evidence_scopes AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY deny_exit_provider_evidence ON piggyvest_savings_exit_execution.provider_evidence AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY deny_exit_accounting_authorities ON piggyvest_savings_exit_execution.accounting_authorities AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY deny_exit_accounting_receipts ON piggyvest_savings_exit_execution.accounting_receipts AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON piggyvest_savings_exit_execution.evidence_scopes
  FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON piggyvest_savings_exit_execution.evidence_scopes
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON piggyvest_savings_exit_execution.provider_evidence
  FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON piggyvest_savings_exit_execution.provider_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON piggyvest_savings_exit_execution.accounting_authorities
  FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON piggyvest_savings_exit_execution.accounting_authorities
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON piggyvest_savings_exit_execution.accounting_receipts
  FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON piggyvest_savings_exit_execution.accounting_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
REVOKE ALL ON piggyvest_savings_exit_execution.evidence_scopes,
  piggyvest_savings_exit_execution.provider_evidence, piggyvest_savings_exit_execution.accounting_authorities,
  piggyvest_savings_exit_execution.accounting_receipts FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE piggyvest_savings_exit_execution.accounting_authorities IS
  'Empty-by-default, immutable, independently provisioned economic and existing-order authority. No user RPC can provision this. All amounts are explicit, not defaults. Local fixtures are not owner approval.';
COMMENT ON TABLE piggyvest_savings_exit_execution.accounting_receipts IS
  'Append-only consumption state for the immutable projection queue. Accounted means ledger and public transaction/order accounting committed, not delivery, customer completion, or legacy savings redemption.';
COMMIT;
