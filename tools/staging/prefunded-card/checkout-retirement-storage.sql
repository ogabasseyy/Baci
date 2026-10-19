ALTER TABLE prefunded_card.operations ADD COLUMN checkout_retired boolean NOT NULL DEFAULT false;

CREATE TABLE prefunded_card.checkout_retirements (
  operation_id uuid PRIMARY KEY REFERENCES prefunded_card.operations(id),
  intent_id uuid NOT NULL UNIQUE REFERENCES prefunded_card.checkout_intents(id),
  integration_id uuid NOT NULL,
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_bindings(id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  collection_reference text NOT NULL,
  transfer_reference text NOT NULL,
  intent_before_sha256 text NOT NULL CHECK (intent_before_sha256 ~ '^[a-f0-9]{64}$'),
  operation_before_sha256 text NOT NULL CHECK (operation_before_sha256 ~ '^[a-f0-9]{64}$'),
  approval jsonb NOT NULL CHECK (jsonb_typeof(approval)='object'),
  retired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_by name NOT NULL DEFAULT session_user,
  CHECK (operation_id=intent_id)
);
CREATE INDEX checkout_retirement_treasury_idx ON prefunded_card.checkout_retirements(treasury_binding_id);
CREATE INDEX checkout_retirement_integration_idx ON prefunded_card.checkout_retirements(integration_id);
ALTER TABLE prefunded_card.checkout_retirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY checkout_retirements_deny ON prefunded_card.checkout_retirements USING(false) WITH CHECK(false);
REVOKE ALL ON prefunded_card.checkout_retirements FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER checkout_retirements_immutable BEFORE UPDATE OR DELETE ON prefunded_card.checkout_retirements
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER checkout_retirements_no_truncate BEFORE TRUNCATE ON prefunded_card.checkout_retirements
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();

CREATE FUNCTION prefunded_card.checkout_is_retired(p_operation uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE retired boolean;
BEGIN
  SELECT checkout_retired INTO retired FROM prefunded_card.operations WHERE id=p_operation FOR SHARE;
  RETURN coalesce(retired,false);
END
$$;
REVOKE ALL ON FUNCTION prefunded_card.checkout_is_retired(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION prefunded_card.guard_retired_checkout_operation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.checkout_retired THEN RAISE EXCEPTION 'new operation cannot be retired' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.checkout_retired AND NOT (
    NEW.projection_status='reconciliation_required'
    AND (to_jsonb(NEW)-'projection_status') IS NOT DISTINCT FROM (to_jsonb(OLD)-'projection_status')
  ) THEN
    RAISE EXCEPTION 'retired checkout cannot advance' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkout_retired_operation_guard BEFORE INSERT OR UPDATE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_retired_checkout_operation();

CREATE FUNCTION prefunded_card.guard_retired_checkout_credit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE denied boolean;
BEGIN
  IF TG_TABLE_SCHEMA='piggyvest_savings_ledger' THEN
    denied:=prefunded_card.checkout_is_retired(NEW.id) OR prefunded_card.checkout_is_retired(NEW.reference_id);
    IF NEW.evidence_id ~ '^pvb-card:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      denied:=denied OR prefunded_card.checkout_is_retired(substr(NEW.evidence_id,10)::uuid);
    END IF;
  ELSE
    denied:=prefunded_card.checkout_is_retired(NEW.operation_id);
  END IF;
  IF denied THEN RAISE EXCEPTION 'retired checkout credit denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkout_retired_ledger_guard BEFORE INSERT ON piggyvest_savings_ledger.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_retired_checkout_credit();
CREATE TRIGGER checkout_retired_projection_guard BEFORE INSERT ON prefunded_card.projections
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_retired_checkout_credit();
CREATE TRIGGER checkout_retired_alias_guard BEFORE INSERT ON prefunded_card.provider_aliases
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_retired_checkout_credit();
REVOKE ALL ON FUNCTION prefunded_card.guard_retired_checkout_operation(),prefunded_card.guard_retired_checkout_credit()
  FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE prefunded_card.checkout_intents DROP CONSTRAINT checkout_intents_phase_check;
ALTER TABLE prefunded_card.checkout_intents ADD CONSTRAINT checkout_intents_phase_check CHECK (phase IN (
  'reserved','initializing','ready','pending','reconciliation_required','funding_pending','completed','retired_unconfirmed'
));
DROP INDEX prefunded_card.prefunded_first_card_one_unresolved_customer;
CREATE UNIQUE INDEX prefunded_first_card_one_unresolved_customer
  ON prefunded_card.checkout_intents(integration_id,merchant_id,customer_id)
  WHERE phase NOT IN ('funding_pending','completed','retired_unconfirmed');
