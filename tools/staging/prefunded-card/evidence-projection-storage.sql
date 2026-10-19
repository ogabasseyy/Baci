BEGIN;
CREATE TABLE prefunded_card.bank_projections (
  integration_id uuid NOT NULL,
  provider_transaction_id text COLLATE "C" NOT NULL,
  event_id text COLLATE "C" NOT NULL,
  operation_id uuid NOT NULL UNIQUE REFERENCES piggyvest_savings_ledger.operations(id),
  contribution_id uuid NOT NULL UNIQUE REFERENCES public.customer_savings_contributions(id) DEFERRABLE INITIALLY DEFERRED,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9007199254740991),
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  PRIMARY KEY(integration_id,provider_transaction_id),
  FOREIGN KEY(integration_id,event_id) REFERENCES prefunded_card.provider_evidence(integration_id,event_id),
  FOREIGN KEY(integration_id,merchant_id,customer_id,goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id,merchant_id,customer_id,goal_id)
);
CREATE INDEX prefunded_bank_projection_merchant_idx ON prefunded_card.bank_projections(merchant_id);
CREATE INDEX prefunded_bank_projection_customer_idx ON prefunded_card.bank_projections(customer_id);
CREATE INDEX prefunded_bank_projection_goal_idx ON prefunded_card.bank_projections(goal_id);
CREATE INDEX prefunded_bank_projection_event_idx ON prefunded_card.bank_projections(integration_id,event_id);
CREATE TABLE prefunded_card.bank_evidence_conflicts (
  integration_id uuid NOT NULL,
  provider_transaction_id text COLLATE "C" NOT NULL,
  conflicting_event_id text COLLATE "C" NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,provider_transaction_id,conflicting_event_id),
  FOREIGN KEY(integration_id,provider_transaction_id) REFERENCES prefunded_card.bank_projections(integration_id,provider_transaction_id),
  FOREIGN KEY(integration_id,conflicting_event_id) REFERENCES prefunded_card.provider_evidence(integration_id,event_id)
);
CREATE INDEX prefunded_bank_conflict_event_idx ON prefunded_card.bank_evidence_conflicts(integration_id,conflicting_event_id);
ALTER TABLE prefunded_card.bank_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.bank_evidence_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefunded_bank_projections_deny ON prefunded_card.bank_projections USING(false) WITH CHECK(false);
CREATE POLICY prefunded_bank_conflicts_deny ON prefunded_card.bank_evidence_conflicts USING(false) WITH CHECK(false);
REVOKE ALL ON prefunded_card.bank_projections,prefunded_card.bank_evidence_conflicts FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
CREATE TRIGGER prefunded_bank_projection_immutable BEFORE UPDATE OR DELETE ON prefunded_card.bank_projections
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_bank_projection_no_truncate BEFORE TRUNCATE ON prefunded_card.bank_projections
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_bank_conflict_immutable BEFORE UPDATE OR DELETE ON prefunded_card.bank_evidence_conflicts
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_bank_conflict_no_truncate BEFORE TRUNCATE ON prefunded_card.bank_evidence_conflicts
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
DO $$ DECLARE definition text; BEGIN
  SELECT regexp_replace(lower(pg_get_constraintdef(oid)),'[[:space:]()]|::text(\[\])?','','g') INTO definition
    FROM pg_constraint WHERE conrelid='public.customer_savings_contributions'::regclass
      AND conname='customer_savings_contributions_source_type_check';
  IF definition='checksource_type=anyarray[''wallet'',''paystack_authorization'',''manual_adjustment'']' THEN
    ALTER TABLE public.customer_savings_contributions DROP CONSTRAINT customer_savings_contributions_source_type_check;
    ALTER TABLE public.customer_savings_contributions ADD CONSTRAINT customer_savings_contributions_source_type_check
      CHECK (source_type=ANY(ARRAY['wallet','paystack_authorization','manual_adjustment','piggyvest_inflow']::text[]));
  ELSIF definition IS DISTINCT FROM 'checksource_type=anyarray[''wallet'',''paystack_authorization'',''manual_adjustment'',''piggyvest_inflow'']' THEN
    RAISE EXCEPTION 'unexpected savings contribution source constraint';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION prefunded_card.guard_contribution() RETURNS trigger
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
    SELECT true INTO valid FROM prefunded_card.bank_projections projection
      WHERE projection.contribution_id=NEW.id AND projection.created_xid=pg_current_xact_id()
        AND projection.goal_id=NEW.goal_id AND projection.merchant_id=NEW.merchant_id AND projection.customer_id=NEW.customer_id
        AND projection.amount_kobo::numeric/100=NEW.amount AND NEW.status='completed'
        AND NEW.source_type='piggyvest_inflow' AND NEW.idempotency_key='pvb-bank:'||projection.operation_id;
    IF valid IS TRUE THEN RETURN NEW; END IF;
  ELSIF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enrolled savings requires canonical contribution projection' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.guard_contribution() FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
COMMIT;
