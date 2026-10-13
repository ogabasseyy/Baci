BEGIN;

CREATE TABLE piggyvest_savings_exit_execution.wallet_authorities (
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  provider_wallet_id text COLLATE "C" NOT NULL CHECK (octet_length(provider_wallet_id) BETWEEN 1 AND 512),
  authority_kind text NOT NULL CHECK (authority_kind IN ('merchant','customer')),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid REFERENCES public.customers(id), verified_at timestamptz NOT NULL,
  PRIMARY KEY (integration_id, provider_wallet_id),
  CHECK ((authority_kind = 'merchant' AND customer_id IS NULL) OR (authority_kind = 'customer' AND customer_id IS NOT NULL))
);
CREATE TABLE piggyvest_savings_exit_execution.provisioned_policies (
  policy_id uuid PRIMARY KEY, integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id), customer_id uuid NOT NULL REFERENCES public.customers(id),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id), action text NOT NULL CHECK (action IN ('purchase','cancellation')),
  revision_id uuid NOT NULL, version text COLLATE "C" NOT NULL CHECK (octet_length(version) BETWEEN 1 AND 128),
  source_wallet_id text COLLATE "C" NOT NULL CHECK (octet_length(source_wallet_id) BETWEEN 1 AND 512),
  purchase_destination_wallet_id text COLLATE "C" NOT NULL CHECK (octet_length(purchase_destination_wallet_id) BETWEEN 1 AND 512),
  cancellation_destination_wallet_id text COLLATE "C" NOT NULL CHECK (octet_length(cancellation_destination_wallet_id) BETWEEN 1 AND 512),
  purchase_requires_fully_funded_goal boolean NOT NULL CHECK (purchase_requires_fully_funded_goal),
  purchase_paid_interest_disposition text NOT NULL CHECK (purchase_paid_interest_disposition = 'retain'),
  cancellation_principal_disposition text NOT NULL CHECK (cancellation_principal_disposition = 'return_to_owned_wallet'),
  cancellation_paid_interest_disposition text NOT NULL CHECK (cancellation_paid_interest_disposition = 'retain'),
  cancellation_pending_interest_disposition text NOT NULL CHECK (cancellation_pending_interest_disposition = 'retain'),
  cancellation_fee_kobo bigint NOT NULL CHECK (cancellation_fee_kobo BETWEEN 0 AND 9007199254740991),
  provisioned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (integration_id, merchant_id, customer_id, goal_id, revision_id, action),
  CHECK (source_wallet_id <> purchase_destination_wallet_id), CHECK (source_wallet_id <> cancellation_destination_wallet_id)
);
CREATE TABLE piggyvest_savings_exit_execution.projection_queue (
  projection_id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE REFERENCES piggyvest_savings_exit_execution.operations(operation_id),
  projection_kind text NOT NULL CHECK (projection_kind IN ('pending_order','pending_refund')),
  state text NOT NULL CHECK (state = 'pending_projection'), authority_snapshot jsonb NOT NULL, transfer jsonb NOT NULL,
  finality jsonb NOT NULL, created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(), enqueued_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE piggyvest_savings_exit_execution.reconciliation_obligations (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_savings_exit_execution.operations(operation_id),
  state text NOT NULL CHECK (state = 'requires_release_or_recovery'), finality jsonb NOT NULL,
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE piggyvest_savings_exit_execution.wallet_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_savings_exit_execution.provisioned_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_savings_exit_execution.projection_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_savings_exit_execution.reconciliation_obligations ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_savings_exit_wallet_authorities ON piggyvest_savings_exit_execution.wallet_authorities AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY deny_savings_exit_provisioned_policies ON piggyvest_savings_exit_execution.provisioned_policies AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY deny_savings_exit_projection_queue ON piggyvest_savings_exit_execution.projection_queue AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY deny_savings_exit_reconciliation_obligations ON piggyvest_savings_exit_execution.reconciliation_obligations AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON ALL TABLES IN SCHEMA piggyvest_savings_exit_execution FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION piggyvest_savings_exit_execution.guard_immutable_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'savings exit authority is immutable' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'wallet_authorities' THEN
    IF NOT EXISTS (SELECT 1 FROM piggyvest_staging.integrations registry WHERE registry.id = NEW.integration_id AND registry.enabled)
      OR (NEW.authority_kind = 'customer' AND NOT EXISTS (SELECT 1 FROM public.customers customer WHERE customer.id = NEW.customer_id AND customer.merchant_id = NEW.merchant_id)) THEN
      RAISE EXCEPTION 'invalid savings exit wallet authority' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings source WHERE source.integration_id = NEW.integration_id AND source.merchant_id = NEW.merchant_id AND source.customer_id = NEW.customer_id AND source.goal_id = NEW.goal_id AND source.provider_wallet_id = NEW.source_wallet_id)
    OR NOT EXISTS (SELECT 1 FROM piggyvest_savings_exit_execution.wallet_authorities destination WHERE destination.integration_id = NEW.integration_id AND destination.merchant_id = NEW.merchant_id AND destination.provider_wallet_id = NEW.purchase_destination_wallet_id AND destination.authority_kind = 'merchant')
    OR NOT EXISTS (SELECT 1 FROM piggyvest_savings_exit_execution.wallet_authorities destination WHERE destination.integration_id = NEW.integration_id AND destination.merchant_id = NEW.merchant_id AND destination.customer_id = NEW.customer_id AND destination.provider_wallet_id = NEW.cancellation_destination_wallet_id AND destination.authority_kind = 'customer') THEN
    RAISE EXCEPTION 'invalid savings exit policy authority' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION piggyvest_savings_exit_execution.guard_operation_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'savings exit operation is immutable' USING ERRCODE = '23514'; END IF;
  IF OLD.operation_id IS DISTINCT FROM NEW.operation_id OR OLD.integration_id IS DISTINCT FROM NEW.integration_id
    OR OLD.merchant_id IS DISTINCT FROM NEW.merchant_id OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
    OR OLD.goal_id IS DISTINCT FROM NEW.goal_id OR OLD.actor_id IS DISTINCT FROM NEW.actor_id OR OLD.action IS DISTINCT FROM NEW.action
    OR OLD.policy IS DISTINCT FROM NEW.policy OR OLD.transfer IS DISTINCT FROM NEW.transfer OR OLD.authority_snapshot IS DISTINCT FROM NEW.authority_snapshot
    OR OLD.settlement_operation_id IS DISTINCT FROM NEW.settlement_operation_id OR OLD.canonical_posting IS DISTINCT FROM NEW.canonical_posting
    OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.state <> 'verify' OR NEW.state NOT IN ('pending_projection','requires_reconciliation')
    OR OLD.finality IS NOT NULL OR NEW.finality IS NULL OR OLD.finalized_at IS NOT NULL OR NEW.finalized_at IS NULL THEN
    RAISE EXCEPTION 'invalid savings exit transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'pending_projection' AND NOT EXISTS (SELECT 1 FROM piggyvest_savings_exit_execution.projection_queue queued WHERE queued.operation_id = NEW.operation_id AND queued.state = 'pending_projection' AND queued.finality = NEW.finality AND queued.created_xid = pg_current_xact_id()) THEN
    RAISE EXCEPTION 'missing same-transaction canonical projection' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'requires_reconciliation' AND NOT EXISTS (SELECT 1 FROM piggyvest_savings_exit_execution.reconciliation_obligations obligation WHERE obligation.operation_id = NEW.operation_id AND obligation.state = 'requires_release_or_recovery' AND obligation.finality = NEW.finality AND obligation.created_xid = pg_current_xact_id()) THEN
    RAISE EXCEPTION 'missing same-transaction reconciliation obligation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'savings exit record is immutable' USING ERRCODE = '23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER guard_savings_exit_wallet_authorities_rows BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_savings_exit_execution.wallet_authorities FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_authority();
CREATE TRIGGER guard_savings_exit_wallet_authorities_truncate BEFORE TRUNCATE ON piggyvest_savings_exit_execution.wallet_authorities FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_authority();
CREATE TRIGGER guard_savings_exit_provisioned_policies_rows BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_savings_exit_execution.provisioned_policies FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_authority();
CREATE TRIGGER guard_savings_exit_provisioned_policies_truncate BEFORE TRUNCATE ON piggyvest_savings_exit_execution.provisioned_policies FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_authority();
CREATE TRIGGER guard_savings_exit_operations_mutation BEFORE UPDATE OR DELETE ON piggyvest_savings_exit_execution.operations FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_operation_mutation();
CREATE TRIGGER guard_savings_exit_operations_truncate BEFORE TRUNCATE ON piggyvest_savings_exit_execution.operations FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_operation_mutation();
CREATE TRIGGER guard_savings_exit_projection_queue_rows BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_savings_exit_execution.projection_queue FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
CREATE TRIGGER guard_savings_exit_projection_queue_truncate BEFORE TRUNCATE ON piggyvest_savings_exit_execution.projection_queue FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
CREATE TRIGGER guard_savings_exit_reconciliation_obligations_rows BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_savings_exit_execution.reconciliation_obligations FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
CREATE TRIGGER guard_savings_exit_reconciliation_obligations_truncate BEFORE TRUNCATE ON piggyvest_savings_exit_execution.reconciliation_obligations FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_exit_execution.guard_immutable_record();
ALTER TABLE piggyvest_savings_exit_execution.operations DROP CONSTRAINT operations_state_check;
ALTER TABLE piggyvest_savings_exit_execution.operations ADD CONSTRAINT operations_state_check CHECK (state IN ('verify','pending_projection','requires_reconciliation'));
ALTER TABLE piggyvest_savings_exit_execution.operations ADD COLUMN authority_snapshot jsonb;
DROP FUNCTION piggyvest_savings_exit_execution.begin(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb);
REVOKE ALL ON FUNCTION piggyvest_savings_exit_execution.guard_immutable_authority(), piggyvest_savings_exit_execution.guard_operation_mutation(), piggyvest_savings_exit_execution.guard_immutable_record() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE piggyvest_savings_exit_execution.provisioned_policies IS 'Immutable, out-of-band authority and economics snapshot. There is no request or user provisioning path. Insert only after trusted provider-wallet ownership verification; begin rechecks exact goal mapping and destination authority.';
COMMENT ON TABLE piggyvest_savings_exit_execution.projection_queue IS 'Durable pending canonical projection only. A parent-owned canonical order/refund projector must consume it atomically before customer completion is reported; this lane does not settle reservations.';
COMMENT ON TABLE piggyvest_savings_exit_execution.reconciliation_obligations IS 'A confirmed provider failure retains the reservation and creates a durable release-or-recovery obligation. No release economics are inferred here.';
COMMIT;
