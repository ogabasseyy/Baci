BEGIN;
-- Purchase-preparation prerequisite tables. The savings exit-execution chain
-- declares %ROWTYPE variables over piggyvest_purchase_preparation.intents and
-- .quotes, which fails compilation when the schema is absent, so the exit
-- migrations cannot replay on a clean database. This backfill provides the
-- tables at the exact missing manifest version (sorts before every consumer);
-- column shapes are derived from the in-chain readers plus the exit fixture's
-- quote projection.
--
-- Tables only, deliberately: the preparation command functions
-- (prepare/quote/status plus the payment-leg and current-recovery readers)
-- were never ported from the source worktree, and reconstructing financial
-- command behavior from consumers is not safe review-round work. Runtime
-- purchase/exit calls fail the same way before and after this migration
-- (missing function); replay is what this fixes. The remaining unported
-- subsystems from the pending-sources manifest (cancel_plan, device_change,
-- draft_closure, collection_reconciliation, and the purchase command
-- functions) stay a tracked follow-up: none is referenced at DDL time by any
-- in-chain migration, so none blocks replay.
CREATE SCHEMA IF NOT EXISTS piggyvest_purchase_preparation;
REVOKE ALL ON SCHEMA piggyvest_purchase_preparation FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_purchase_preparation.intents (
  operation_id uuid PRIMARY KEY,
  integration_id uuid,
  merchant_id uuid REFERENCES public.merchants(id),
  customer_id uuid REFERENCES public.customers(id),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  actor_id uuid NOT NULL,
  quote_id uuid,
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX piggyvest_purchase_preparation_intents_goal_idx
  ON piggyvest_purchase_preparation.intents (goal_id);
ALTER TABLE piggyvest_purchase_preparation.intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_purchase_preparation.intents FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_purchase_preparation.quotes (
  id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  revision_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  variant_id uuid REFERENCES public.product_variants(id),
  condition text,
  currency text NOT NULL DEFAULT 'NGN',
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  current_device_kobo bigint NOT NULL DEFAULT 0 CHECK (current_device_kobo >= 0),
  delivery_kobo bigint NOT NULL DEFAULT 0 CHECK (delivery_kobo >= 0),
  tax_kobo bigint NOT NULL DEFAULT 0 CHECK (tax_kobo >= 0),
  fee_kobo bigint NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  savings_kobo bigint NOT NULL DEFAULT 0 CHECK (savings_kobo >= 0),
  quoted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT false
);
CREATE INDEX piggyvest_purchase_preparation_quotes_goal_idx
  ON piggyvest_purchase_preparation.quotes (goal_id);
ALTER TABLE piggyvest_purchase_preparation.quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_purchase_preparation.quotes FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON SCHEMA piggyvest_purchase_preparation IS
  'Purchase-preparation prerequisite tables (replay support). Column shapes derived from in-chain exit readers and the exit quote projection. Command functions remain unported; see migration header.';
COMMIT;
