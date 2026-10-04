CREATE TABLE IF NOT EXISTS piggyvest_staging.goal_inflow_projections (
  provider_transaction_id text PRIMARY KEY
    REFERENCES public.piggyvest_inflow_credits(provider_transaction_id),
  integration_id uuid NOT NULL,
  provider_wallet_id text NOT NULL,
  provider_customer_id text NOT NULL,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  contribution_id uuid NOT NULL UNIQUE REFERENCES public.customer_savings_contributions(id),
  event_data_id text NOT NULL,
  event_id text NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  fee_kobo bigint NOT NULL CHECK (fee_kobo = 0),
  reference text NOT NULL,
  session_id text,
  credited_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  FOREIGN KEY (integration_id, provider_wallet_id)
    REFERENCES piggyvest_staging.wallet_goal_mappings(integration_id, provider_wallet_id),
  CHECK (pg_catalog.octet_length(provider_transaction_id) BETWEEN 1 AND 512),
  CHECK (pg_catalog.octet_length(provider_customer_id) BETWEEN 1 AND 512),
  CHECK (pg_catalog.octet_length(provider_wallet_id) BETWEEN 1 AND 512)
);
ALTER TABLE piggyvest_staging.goal_inflow_projections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_staging.goal_inflow_projections
  FROM PUBLIC, anon, authenticated, service_role, pvb_staging_app_worker;
CREATE INDEX IF NOT EXISTS goal_inflow_projections_merchant_idx
  ON piggyvest_staging.goal_inflow_projections (merchant_id);
CREATE INDEX IF NOT EXISTS goal_inflow_projections_customer_idx
  ON piggyvest_staging.goal_inflow_projections (customer_id);
CREATE INDEX IF NOT EXISTS goal_inflow_projections_goal_idx
  ON piggyvest_staging.goal_inflow_projections (goal_id);

CREATE OR REPLACE FUNCTION piggyvest_staging.reject_goal_inflow_projection_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  RAISE EXCEPTION 'PiggyVest goal inflow projection is immutable' USING ERRCODE = '23514';
END
$function$;
REVOKE ALL ON FUNCTION piggyvest_staging.reject_goal_inflow_projection_mutation()
  FROM PUBLIC, anon, authenticated, service_role, pvb_staging_app_worker;
DROP TRIGGER IF EXISTS goal_inflow_projection_immutable
  ON piggyvest_staging.goal_inflow_projections;
CREATE TRIGGER goal_inflow_projection_immutable
  BEFORE UPDATE OR DELETE ON piggyvest_staging.goal_inflow_projections
  FOR EACH ROW EXECUTE FUNCTION piggyvest_staging.reject_goal_inflow_projection_mutation();
DROP TRIGGER IF EXISTS goal_inflow_projection_no_truncate
  ON piggyvest_staging.goal_inflow_projections;
CREATE TRIGGER goal_inflow_projection_no_truncate
  BEFORE TRUNCATE ON piggyvest_staging.goal_inflow_projections
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_staging.reject_goal_inflow_projection_mutation();
