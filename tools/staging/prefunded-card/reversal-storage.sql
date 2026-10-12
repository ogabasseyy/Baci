BEGIN;
CREATE TABLE prefunded_card.collection_reversal_events (
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  event_id text COLLATE "C" NOT NULL CHECK (event_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  operation_id uuid NOT NULL REFERENCES prefunded_card.operations(id),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
  verified_by name NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (integration_id,event_id)
);
CREATE INDEX prefunded_reversal_events_operation_idx ON prefunded_card.collection_reversal_events(operation_id);
CREATE TABLE prefunded_card.collection_reversal_obligations (
  operation_id uuid PRIMARY KEY REFERENCES prefunded_card.operations(id),
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_bindings(id),
  first_event_id text COLLATE "C" NOT NULL,
  collection_amount_kobo bigint NOT NULL CHECK (collection_amount_kobo BETWEEN 1 AND 9007199254740991),
  transfer_status_at_recording text NOT NULL,
  transfer_transaction_id_at_recording text,
  projection_status_at_recording text NOT NULL,
  exposure text NOT NULL CHECK (exposure IN ('transfer_not_started','transfer_in_flight','transfer_completed','transfer_failed')),
  reserved_kobo_at_recording bigint NOT NULL CHECK (reserved_kobo_at_recording >= 0),
  consumed_kobo_at_recording bigint NOT NULL CHECK (consumed_kobo_at_recording >= 0),
  obligation text NOT NULL DEFAULT 'review_required' CHECK (obligation='review_required'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (integration_id,first_event_id) REFERENCES prefunded_card.collection_reversal_events(integration_id,event_id),
  FOREIGN KEY (integration_id,merchant_id,customer_id,goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id,merchant_id,customer_id,goal_id)
);
CREATE INDEX prefunded_reversal_obligations_event_idx ON prefunded_card.collection_reversal_obligations(integration_id,first_event_id);
CREATE INDEX prefunded_reversal_obligations_binding_idx ON prefunded_card.collection_reversal_obligations(integration_id,merchant_id,customer_id,goal_id);
CREATE INDEX prefunded_reversal_obligations_treasury_idx ON prefunded_card.collection_reversal_obligations(treasury_binding_id);
ALTER TABLE prefunded_card.collection_reversal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.collection_reversal_obligations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prefunded_card.collection_reversal_events,prefunded_card.collection_reversal_obligations
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION prefunded_card.reject_reversal_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'prefunded reversal evidence immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER prefunded_reversal_events_immutable BEFORE UPDATE OR DELETE ON prefunded_card.collection_reversal_events
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_reversal_mutation();
CREATE TRIGGER prefunded_reversal_events_no_truncate BEFORE TRUNCATE ON prefunded_card.collection_reversal_events
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_reversal_mutation();
CREATE TRIGGER prefunded_reversal_obligations_immutable BEFORE UPDATE OR DELETE ON prefunded_card.collection_reversal_obligations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_reversal_mutation();
CREATE TRIGGER prefunded_reversal_obligations_no_truncate BEFORE TRUNCATE ON prefunded_card.collection_reversal_obligations
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_reversal_mutation();
REVOKE ALL ON FUNCTION prefunded_card.reject_reversal_mutation() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
