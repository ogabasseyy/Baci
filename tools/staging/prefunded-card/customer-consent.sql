BEGIN;
CREATE TABLE prefunded_card.customer_consents (
  operation_id uuid PRIMARY KEY REFERENCES prefunded_card.operations(id),
  actor_id uuid NOT NULL,
  consent_version text NOT NULL CHECK (consent_version='prefunded-card-v1'),
  one_time_charge boolean NOT NULL CHECK (one_time_charge),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  authorized_login name NOT NULL,
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  database_name name NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX prefunded_customer_consent_actor_idx ON prefunded_card.customer_consents(actor_id);
ALTER TABLE prefunded_card.customer_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefunded_customer_consents_deny ON prefunded_card.customer_consents USING(false) WITH CHECK(false);
REVOKE ALL ON prefunded_card.customer_consents FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION prefunded_card.reject_customer_consent_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'prefunded customer consent refused' USING ERRCODE='42501'; END $$;
CREATE TRIGGER prefunded_customer_consent_immutable BEFORE UPDATE OR DELETE ON prefunded_card.customer_consents
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_customer_consent_mutation();
CREATE TRIGGER prefunded_customer_consent_no_truncate BEFORE TRUNCATE ON prefunded_card.customer_consents
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_customer_consent_mutation();

CREATE FUNCTION prefunded_card.record_customer_consent(p_operation uuid,p_actor uuid,p_consent jsonb,p_system text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  IF p_consent IS DISTINCT FROM '{"version":"prefunded-card-v1","oneTimeCharge":true}'::jsonb
    OR current_setting('transaction_isolation')<>'read committed'
    OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'prefunded customer consent refused' USING ERRCODE='42501'; END IF;
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_ledger_worker');
  SELECT stored.* INTO STRICT operation FROM prefunded_card.operations stored
    JOIN prefunded_card.treasury_bindings treasury ON treasury.id=stored.treasury_binding_id
      AND treasury.integration_id=stored.integration_id AND treasury.merchant_id=stored.merchant_id
      AND treasury.authorized_login=session_user
    JOIN public.customers customer ON customer.id=stored.customer_id AND customer.merchant_id=stored.merchant_id
      AND customer.user_id=p_actor
    WHERE stored.id=p_operation FOR SHARE OF stored,treasury,customer;
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  INSERT INTO prefunded_card.customer_consents(operation_id,actor_id,consent_version,one_time_charge,
    request_fingerprint,authorized_login,system_identifier,database_name)
    VALUES(operation.id,p_actor,'prefunded-card-v1',true,operation.request_fingerprint,session_user,p_system,current_database());
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer consent refused' USING ERRCODE='42501'; END IF;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded customer consent refused' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.reject_customer_consent_mutation(),
  prefunded_card.record_customer_consent(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
