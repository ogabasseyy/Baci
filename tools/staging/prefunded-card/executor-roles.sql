BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_treasury_ledger_worker') THEN
    CREATE ROLE prefunded_treasury_ledger_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_card_authorization_reader') THEN
    CREATE ROLE prefunded_card_authorization_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_card_authorization_provisioner') THEN
    CREATE ROLE prefunded_card_authorization_provisioner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_treasury_operator') THEN
    CREATE ROLE prefunded_treasury_operator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_authorizer') THEN
    CREATE ROLE prefunded_authorizer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_evidence') THEN
    CREATE ROLE prefunded_evidence LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator;
GRANT prefunded_card_authorization_reader TO prefunded_treasury_operator;
GRANT prefunded_card_authorization_provisioner TO prefunded_authorizer;
REVOKE EXECUTE ON FUNCTION prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_status(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid), prefunded_card.finish_dispatch(uuid,uuid,text), prefunded_card.read_operation(uuid,text), prefunded_card.project(uuid,text), prefunded_card.reserve(jsonb), prefunded_card.claim_collection(uuid,bigint), prefunded_card.record_collection(uuid,bigint,text,jsonb), prefunded_card.claim_transfer(uuid,bigint), prefunded_card.record_transfer(uuid,bigint,text,jsonb), prefunded_card.claim_reconciliation(uuid,integer), prefunded_card.complete_reconciliation(uuid,uuid,bigint,text,text,jsonb), prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text), prefunded_card.read_transfer_evidence(uuid,text), prefunded_card.classify_provider_inflow(uuid,text,text), prefunded_card.apply_classified_inflow(uuid,text,text), prefunded_card.read_reversal_context(uuid,text), prefunded_card.record_collection_reversal(text,jsonb), prefunded_card.authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text), prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb), prefunded_card.evidence_scope(uuid,text), prefunded_card.record_provider_evidence(uuid,text,jsonb), prefunded_card.evidence_destination_mapping(uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_status(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid), prefunded_card.finish_dispatch(uuid,uuid,text), prefunded_card.read_operation(uuid,text), prefunded_card.project(uuid,text), prefunded_card.reserve(jsonb), prefunded_card.claim_collection(uuid,bigint), prefunded_card.record_collection(uuid,bigint,text,jsonb), prefunded_card.claim_transfer(uuid,bigint), prefunded_card.record_transfer(uuid,bigint,text,jsonb), prefunded_card.claim_reconciliation(uuid,integer), prefunded_card.complete_reconciliation(uuid,uuid,bigint,text,text,jsonb), prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text), prefunded_card.read_transfer_evidence(uuid,text), prefunded_card.classify_provider_inflow(uuid,text,text), prefunded_card.apply_classified_inflow(uuid,text,text), prefunded_card.read_reversal_context(uuid,text), prefunded_card.record_collection_reversal(text,jsonb), prefunded_card.authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text), prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb), prefunded_card.evidence_scope(uuid,text), prefunded_card.record_provider_evidence(uuid,text,jsonb), prefunded_card.evidence_destination_mapping(uuid,text,text) FROM prefunded_treasury_operator, prefunded_authorizer, prefunded_evidence;
REVOKE ALL ON SCHEMA prefunded_card FROM prefunded_treasury_operator, prefunded_authorizer, prefunded_evidence;
GRANT USAGE ON SCHEMA prefunded_card TO prefunded_treasury_operator, prefunded_authorizer, prefunded_evidence;

GRANT EXECUTE ON FUNCTION prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_status(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid), prefunded_card.finish_dispatch(uuid,uuid,text), prefunded_card.read_operation(uuid,text), prefunded_card.project(uuid,text), prefunded_card.reserve(jsonb), prefunded_card.claim_collection(uuid,bigint), prefunded_card.record_collection(uuid,bigint,text,jsonb), prefunded_card.claim_transfer(uuid,bigint), prefunded_card.record_transfer(uuid,bigint,text,jsonb), prefunded_card.claim_reconciliation(uuid,integer), prefunded_card.complete_reconciliation(uuid,uuid,bigint,text,text,jsonb), prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text), prefunded_card.read_transfer_evidence(uuid,text), prefunded_card.classify_provider_inflow(uuid,text,text), prefunded_card.apply_classified_inflow(uuid,text,text), prefunded_card.read_reversal_context(uuid,text), prefunded_card.record_collection_reversal(text,jsonb) TO prefunded_treasury_operator;
GRANT EXECUTE ON FUNCTION prefunded_card.authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text), prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) TO prefunded_authorizer;
GRANT EXECUTE ON FUNCTION prefunded_card.evidence_scope(uuid,text), prefunded_card.record_provider_evidence(uuid,text,jsonb), prefunded_card.evidence_destination_mapping(uuid,text,text) TO prefunded_evidence;
REVOKE EXECUTE ON FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)
  FROM PUBLIC, prefunded_treasury_operator, prefunded_authorizer, prefunded_evidence;
GRANT EXECUTE ON FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)
  TO prefunded_treasury_operator;
COMMIT;
