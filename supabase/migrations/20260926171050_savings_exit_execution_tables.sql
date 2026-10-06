BEGIN;
-- Savings exit-execution prerequisite tables. The exit commands/evidence
-- migrations declare %ROWTYPE variables over provisioned_policies,
-- provider_evidence, projection_queue, and accounting_authorities, which
-- fails compilation while those tables are absent, so the exit chain cannot
-- replay on a clean database. This backfill provides the four tables between
-- the operations migration and its first consumer; column shapes are derived
-- from the in-chain readers, writers, and the exit fixture's policy
-- projection. Table conventions (plain uuid scope columns, jsonb payloads,
-- RLS enabled with all roles revoked) mirror the operations table.
CREATE TABLE piggyvest_savings_exit_execution.provisioned_policies (
  policy_id uuid PRIMARY KEY,
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('purchase', 'cancellation')),
  revision_id uuid NOT NULL,
  version text NOT NULL,
  source_wallet_id text NOT NULL,
  purchase_destination_wallet_id text,
  cancellation_destination_wallet_id text,
  purchase_requires_fully_funded_goal boolean NOT NULL DEFAULT false,
  purchase_paid_interest_disposition text,
  cancellation_principal_disposition text,
  cancellation_paid_interest_disposition text,
  cancellation_pending_interest_disposition text,
  cancellation_fee_kobo bigint NOT NULL DEFAULT 0 CHECK (cancellation_fee_kobo >= 0)
);
CREATE INDEX savings_exit_provisioned_policies_goal_idx
  ON piggyvest_savings_exit_execution.provisioned_policies (goal_id);
ALTER TABLE piggyvest_savings_exit_execution.provisioned_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_savings_exit_execution.provisioned_policies FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_savings_exit_execution.provider_evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL,
  integration_id uuid,
  provider_transaction_id text,
  event_id text,
  receipt jsonb,
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id()
);
CREATE INDEX savings_exit_provider_evidence_operation_idx
  ON piggyvest_savings_exit_execution.provider_evidence (operation_id);
ALTER TABLE piggyvest_savings_exit_execution.provider_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_savings_exit_execution.provider_evidence FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_savings_exit_execution.projection_queue (
  projection_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  projection_kind text NOT NULL,
  state text NOT NULL,
  authority_snapshot jsonb,
  transfer jsonb,
  finality jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX savings_exit_projection_queue_operation_idx
  ON piggyvest_savings_exit_execution.projection_queue (operation_id);
ALTER TABLE piggyvest_savings_exit_execution.projection_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_savings_exit_execution.projection_queue FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_savings_exit_execution.accounting_authorities (
  operation_id uuid PRIMARY KEY,
  transaction_id uuid,
  order_id uuid,
  platform_fee_kobo bigint NOT NULL DEFAULT 0 CHECK (platform_fee_kobo >= 0),
  merchant_amount_kobo bigint NOT NULL DEFAULT 0 CHECK (merchant_amount_kobo >= 0),
  provider_fee_kobo bigint NOT NULL DEFAULT 0 CHECK (provider_fee_kobo >= 0),
  settlement_id uuid,
  contract jsonb,
  approved_terms_reference text
);
ALTER TABLE piggyvest_savings_exit_execution.accounting_authorities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_savings_exit_execution.accounting_authorities FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE piggyvest_savings_exit_execution.provisioned_policies IS
  'Replay prerequisite: exit policy projections. Shapes derived from in-chain exit readers and the exit fixture.';
COMMIT;
