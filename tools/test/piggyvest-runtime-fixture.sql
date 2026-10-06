INSERT INTO public.merchants (id) VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO public.merchants (id) VALUES ('11111111-1111-4111-8111-111111111112');
INSERT INTO public.customers (id, merchant_id) VALUES
('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111'),
('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'),
('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111');
INSERT INTO public.customers (id, merchant_id) VALUES
('22222222-2222-4222-8222-222222222225', '11111111-1111-4111-8111-111111111112');
INSERT INTO public.customer_savings_goals (id, merchant_id, customer_id)
VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221');
INSERT INTO piggyvest_staging.integrations (id, expected_provider_account_id, enabled)
VALUES ('44444444-4444-4444-8444-444444444444', 'synthetic-business', true);
INSERT INTO piggyvest_staging.provisioning_integrations (integration_id, merchant_id, enabled)
VALUES ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', true);
INSERT INTO piggyvest_savings_ledger.bindings (goal_id, integration_id, merchant_id, customer_id, authorized_login, enabled)
VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 'piggyvest_staging_ledger_worker', true);
GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO piggyvest_staging_ledger_worker;
GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb), piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid) TO piggyvest_staging_ledger_worker;
GRANT USAGE ON SCHEMA piggyvest_staging TO piggyvest_staging_intake, piggyvest_staging_worker, piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.enqueue_inbox(uuid, text, bytea) TO piggyvest_staging_intake;
GRANT EXECUTE ON FUNCTION piggyvest_staging.claim_inbox(uuid, integer, integer), piggyvest_staging.finish_inbox(uuid, uuid, uuid, text, integer) TO piggyvest_staging_worker;
GRANT EXECUTE ON FUNCTION piggyvest_staging.prepare_provisioning_intent(uuid, uuid, uuid, uuid, text, bytea), piggyvest_staging.claim_provisioning_intent(uuid, uuid, uuid, integer, text, text), piggyvest_staging.record_provisioning_result(uuid, uuid, uuid, uuid, text, text, text), piggyvest_staging.expire_provisioning_claim(uuid, uuid, uuid) TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.record_created_customer(uuid,uuid,uuid,uuid,text,text,text) TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.read_customer_mapping(uuid,uuid,uuid,text) TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.resolve_wallet_mapping(uuid,text,text) TO piggyvest_staging_provisioner, piggyvest_staging_worker;
GRANT EXECUTE ON FUNCTION piggyvest_staging.read_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text), piggyvest_staging.observe_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text), piggyvest_staging.begin_provisioning_verification(uuid,uuid,uuid,uuid,uuid,text), piggyvest_staging.confirm_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,text) TO piggyvest_staging_provisioner;
CREATE SCHEMA runtime_test;
CREATE FUNCTION runtime_test.reject_test_event_at_commit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider_event_id = 'synthetic-commit-failure' THEN
    RAISE EXCEPTION 'synthetic-deferred-constraint';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER runtime_commit_failure
AFTER INSERT ON piggyvest_staging.inbox DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION runtime_test.reject_test_event_at_commit();
