BEGIN;
CREATE TABLE prefunded_card.credit_routes (
  goal_id uuid PRIMARY KEY,
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (integration_id,merchant_id,customer_id,goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id,merchant_id,customer_id,goal_id)
);
CREATE TABLE prefunded_card.projections (
  operation_id uuid PRIMARY KEY REFERENCES prefunded_card.operations(id),
  contribution_id uuid NOT NULL UNIQUE REFERENCES public.customer_savings_contributions(id) DEFERRABLE INITIALLY DEFERRED,
  ledger_operation_id uuid NOT NULL UNIQUE REFERENCES piggyvest_savings_ledger.operations(id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9007199254740991),
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (operation_id=ledger_operation_id)
);
CREATE TABLE prefunded_card.provider_aliases (
  integration_id uuid NOT NULL,
  provider_transaction_id text COLLATE "C" NOT NULL CHECK (length(provider_transaction_id) BETWEEN 1 AND 512),
  operation_id uuid NOT NULL REFERENCES prefunded_card.operations(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (integration_id,provider_transaction_id)
);
CREATE INDEX prefunded_card_credit_routes_customer_idx ON prefunded_card.credit_routes(customer_id);
CREATE INDEX prefunded_card_credit_routes_merchant_idx ON prefunded_card.credit_routes(merchant_id);
CREATE INDEX prefunded_card_credit_routes_integration_idx ON prefunded_card.credit_routes(integration_id);
CREATE INDEX prefunded_card_aliases_operation_idx ON prefunded_card.provider_aliases(operation_id);
ALTER TABLE prefunded_card.credit_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.provider_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prefunded_card.credit_routes,prefunded_card.projections,prefunded_card.provider_aliases FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION prefunded_card.reject_projection_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'prefunded projection evidence immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER prefunded_credit_route_immutable BEFORE UPDATE OR DELETE ON prefunded_card.credit_routes
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_credit_route_no_truncate BEFORE TRUNCATE ON prefunded_card.credit_routes
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_projection_immutable BEFORE UPDATE OR DELETE ON prefunded_card.projections
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_projection_no_truncate BEFORE TRUNCATE ON prefunded_card.projections
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_alias_immutable BEFORE UPDATE OR DELETE ON prefunded_card.provider_aliases
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_alias_no_truncate BEFORE TRUNCATE ON prefunded_card.provider_aliases
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();

CREATE FUNCTION prefunded_card.require_credit_route(operation prefunded_card.operations,p_system text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_system IS NULL OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM p_system THEN
    RAISE EXCEPTION 'prefunded projection database refused' USING ERRCODE='42501';
  END IF;
  PERFORM goal_id FROM piggyvest_savings_ledger.bindings WHERE goal_id=operation.goal_id
    AND integration_id=operation.integration_id AND merchant_id=operation.merchant_id AND customer_id=operation.customer_id
    AND authorized_login=session_user AND enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded projection binding refused' USING ERRCODE='42501'; END IF;
  PERFORM goal_id FROM prefunded_card.credit_routes WHERE goal_id=operation.goal_id AND integration_id=operation.integration_id
    AND merchant_id=operation.merchant_id AND customer_id=operation.customer_id AND system_identifier=p_system FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded projection route refused' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION prefunded_card.guard_contribution() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_goal uuid; valid boolean;
BEGIN
  selected_goal:=CASE WHEN TG_OP='DELETE' THEN OLD.goal_id ELSE NEW.goal_id END;
  IF NOT EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id=selected_goal)
    AND (TG_OP<>'UPDATE' OR NOT EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id=OLD.goal_id)) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT true INTO valid FROM prefunded_card.projections projection
      JOIN prefunded_card.operations operation ON operation.id=projection.operation_id
      WHERE projection.contribution_id=NEW.id AND projection.created_xid=pg_current_xact_id()
        AND operation.goal_id=NEW.goal_id AND operation.merchant_id=NEW.merchant_id AND operation.customer_id=NEW.customer_id
        AND projection.amount_kobo::numeric/100=NEW.amount AND NEW.status='completed'
        AND NEW.source_type='paystack_authorization' AND NEW.idempotency_key='pvb-card:'||operation.id;
    IF valid IS TRUE THEN RETURN NEW; END IF;
  ELSIF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enrolled savings requires canonical contribution projection' USING ERRCODE='42501';
END $$;
CREATE TRIGGER prefunded_card_canonical_contribution BEFORE INSERT OR UPDATE OR DELETE ON public.customer_savings_contributions
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_contribution();
REVOKE ALL ON FUNCTION prefunded_card.reject_projection_mutation(),prefunded_card.require_credit_route(prefunded_card.operations,text),
  prefunded_card.guard_contribution() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
