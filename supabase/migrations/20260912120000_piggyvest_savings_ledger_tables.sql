BEGIN;
CREATE SCHEMA piggyvest_savings_ledger;
REVOKE ALL ON SCHEMA piggyvest_savings_ledger FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_savings_ledger.bindings (
  goal_id uuid PRIMARY KEY REFERENCES public.customer_savings_goals(id),
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  authorized_login name NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  UNIQUE (integration_id, merchant_id, customer_id, goal_id)
);
CREATE INDEX savings_ledger_bindings_integration_idx ON piggyvest_savings_ledger.bindings(integration_id);
CREATE INDEX savings_ledger_bindings_merchant_idx ON piggyvest_savings_ledger.bindings(merchant_id);
CREATE INDEX savings_ledger_bindings_customer_idx ON piggyvest_savings_ledger.bindings(customer_id);

CREATE TABLE piggyvest_savings_ledger.operations (
  id uuid PRIMARY KEY,
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  command jsonb NOT NULL,
  evidence_id text COLLATE "C" NOT NULL,
  reference_id uuid REFERENCES piggyvest_savings_ledger.operations(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  FOREIGN KEY (integration_id, merchant_id, customer_id, goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id, merchant_id, customer_id, goal_id),
  UNIQUE(integration_id, evidence_id),
  UNIQUE(reference_id)
);
CREATE INDEX savings_ledger_operations_goal_idx ON piggyvest_savings_ledger.operations(goal_id);
CREATE INDEX savings_ledger_operations_merchant_idx ON piggyvest_savings_ledger.operations(merchant_id);
CREATE INDEX savings_ledger_operations_customer_idx ON piggyvest_savings_ledger.operations(customer_id);
CREATE TABLE piggyvest_savings_ledger.postings (
  operation_id uuid NOT NULL REFERENCES piggyvest_savings_ledger.operations(id),
  account text NOT NULL CHECK (account IN ('principal', 'paid_interest', 'pending_interest',
    'purchase_principal', 'purchase_interest', 'refund_principal', 'internal_clearing', 'pending_clearing')),
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN -9007199254740991 AND 9007199254740991 AND amount_kobo <> 0),
  PRIMARY KEY(operation_id, account)
);
ALTER TABLE piggyvest_savings_ledger.bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_savings_ledger.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_savings_ledger.postings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_bindings_deny ON piggyvest_savings_ledger.bindings USING (false) WITH CHECK (false);
CREATE POLICY ledger_operations_deny ON piggyvest_savings_ledger.operations USING (false) WITH CHECK (false);
CREATE POLICY ledger_postings_deny ON piggyvest_savings_ledger.postings USING (false) WITH CHECK (false);
REVOKE ALL ON ALL TABLES IN SCHEMA piggyvest_savings_ledger FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON SCHEMA piggyvest_savings_ledger IS
  'INTERNAL canonical accounting only. No provider units, events, payloads, cash proof, entitlement or webhook binding. No deployed caller grants. Owner-provisioned bindings default disabled; authorized_login must be a dedicated restricted database login, never an end-user or service-role API. No provider mapping is activated.';
COMMIT;
