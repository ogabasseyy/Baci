BEGIN;
SELECT set_config('test.replay_system',(SELECT system_identifier::text FROM pg_control_system()),true);
GRANT EXECUTE ON FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)
  TO projection_worker;
CREATE FUNCTION public.replay_routing_hints(p_changes jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('eventType','bank-transfer.inflow.success',
    'envelopeWalletId','scratch-public-wallet','envelopeCustomerId','scratch-event-customer',
    'destinationWalletId','scratch-private-wallet','innerCustomerId','scratch-event-customer',
    'sourceWalletId',NULL,'declaredDestinationWalletId',NULL,'references',jsonb_build_array('bank-reference'))||p_changes
$$;
CREATE FUNCTION public.assert_replay_routing(p_hints jsonb,p_expected text,p_scope jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
  actual:=prefunded_card.resolve_replay_enrollment(
    coalesce(p_scope->>'integration','d91d9e87-8e0d-44de-9b84-1e1d709633d2')::uuid,
    coalesce(p_scope->>'merchant','11111111-1111-4111-8111-111111111111')::uuid,
    coalesce(p_scope->>'treasury','50000000-0000-4000-8000-000000000001')::uuid,
    coalesce(p_scope->>'business','business'),coalesce(p_scope->>'database',current_database()),
    coalesce(p_scope->>'system',current_setting('test.replay_system')),p_hints);
  IF actual IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'replay routing assertion failed: expected %, got %',p_expected,actual; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM prefunded_card.provider_evidence) THEN RAISE EXCEPTION 'use fresh evidence fixture'; END IF;
  IF to_regclass('piggyvest_staging.inbox') IS NOT NULL THEN RAISE EXCEPTION 'test must not require a receipt-copy inbox'; END IF;
  IF has_function_privilege('evidence_ingestor',
    'prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)','EXECUTE')
    OR has_function_privilege('anon',
    'prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'unexpected routing grant'; END IF;
END $$;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_replay_routing(public.replay_routing_hints(),'enrolled');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"envelopeWalletId":"scratch-private-wallet","destinationWalletId":"external-provider-wallet"}'),'enrolled');
SELECT public.assert_replay_routing(public.replay_routing_hints(), 'deferred','{"system":"0"}');
SELECT public.assert_replay_routing(public.replay_routing_hints(), 'deferred','{"database":"other_database"}');
SELECT public.assert_replay_routing(public.replay_routing_hints(), 'deferred','{"business":"other_business"}');
SELECT public.assert_replay_routing(public.replay_routing_hints(), 'deferred',
  '{"merchant":"11111111-1111-4111-8111-111111111112"}');
SELECT public.assert_replay_routing(public.replay_routing_hints(), 'deferred',
  '{"treasury":"50000000-0000-4000-8000-000000000099"}');
SELECT public.assert_replay_routing(public.replay_routing_hints(), 'deferred',
  '{"integration":"d91d9e87-8e0d-44de-9b84-1e1d709633d3"}');
SELECT public.assert_replay_routing(public.replay_routing_hints('{"innerCustomerId":"wrong-customer"}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints('{"destinationWalletId":"unknown-wallet"}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints('{"declaredDestinationWalletId":"wrong-wallet"}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints()-'references','deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints('{"references":[null]}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints('{"references":[]}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints('{"enrolled":true}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(jsonb_build_object('references',jsonb_build_array(repeat('x',513)))),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(jsonb_build_object('references',to_jsonb(array_fill('reference'::text,ARRAY[17])))),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"envelopeWalletId":"scratch-public-wallet","destinationWalletId":"scratch-public-wallet",
    "envelopeCustomerId":"scratch-api-customer","innerCustomerId":"scratch-api-customer"}'),'deferred');
RESET SESSION AUTHORIZATION;
SELECT public.assert_replay_routing(public.replay_routing_hints(),'deferred');
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM prefunded_card.provider_evidence)
    OR EXISTS(SELECT 1 FROM prefunded_card.operations)
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.postings)
    OR EXISTS(SELECT 1 FROM public.customer_savings_contributions) THEN
    RAISE EXCEPTION 'routing unexpectedly wrote evidence or money'; END IF;
END $$;
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,goal_kind,source_mode,current_amount,target_amount,status)
VALUES('33333333-3333-4333-8333-333333333399','11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','legacy','manual',0,200,'active');
INSERT INTO piggyvest_staging.wallet_goal_mappings(integration_id,provider_wallet_id,provider_customer_id,merchant_id,customer_id,goal_id)
VALUES('d91d9e87-8e0d-44de-9b84-1e1d709633d2','independent-legacy-wallet','scratch-event-customer',
  '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333399');
INSERT INTO public.piggyvest_plan_wallets(customer_id,merchant_id,piggyvest_customer_id,wallet_id)
VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
  'scratch-event-customer','independent-legacy-wallet');
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"envelopeWalletId":"independent-legacy-wallet","destinationWalletId":"independent-legacy-wallet"}'),'legacy');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"destinationWalletId":"independent-legacy-wallet"}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"envelopeWalletId":"independent-legacy-wallet"}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"envelopeWalletId":"independent-legacy-wallet","destinationWalletId":"independent-legacy-wallet","sourceWalletId":"treasury-wallet"}'),'deferred');
SELECT prefunded_card.reserve(public.evidence_command('70000000-0000-4000-8000-000000000091','routing-transfer-one'));
SELECT prefunded_card.reserve(public.evidence_command('70000000-0000-4000-8000-000000000092','routing-transfer-two'));
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"eventType":"wallet-transfer.outflow.success","envelopeWalletId":"treasury-wallet",
    "innerCustomerId":null,"destinationWalletId":null,"sourceWalletId":null,
    "references":["routing-transfer-one"]}'),'enrolled');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"eventType":"wallet-transfer.outflow.success","envelopeWalletId":"treasury-wallet",
    "innerCustomerId":null,"destinationWalletId":null,"sourceWalletId":null,
    "references":["unknown-transfer"]}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"eventType":"wallet-transfer.outflow.success","envelopeWalletId":"treasury-wallet",
    "sourceWalletId":"wrong-source","references":["routing-transfer-one"]}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"eventType":"wallet-transfer.outflow.success","envelopeWalletId":"treasury-wallet",
    "destinationWalletId":"wrong-destination","references":["routing-transfer-one"]}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"eventType":"wallet-transfer.outflow.success","envelopeWalletId":"treasury-wallet",
    "innerCustomerId":"wrong-customer","references":["routing-transfer-one"]}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"eventType":"wallet-transfer.outflow.success","envelopeWalletId":"treasury-wallet",
    "sourceWalletId":"treasury-wallet","envelopeCustomerId":"sender","innerCustomerId":"sender",
    "references":["routing-transfer-one"]}'),'enrolled');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"eventType":"wallet-transfer.outflow.success","envelopeWalletId":"treasury-wallet",
    "sourceWalletId":"treasury-wallet","references":["unknown-transfer"]}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"references":["routing-transfer-one","routing-transfer-two"]}'),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"envelopeWalletId":"independent-legacy-wallet","destinationWalletId":"independent-legacy-wallet",
    "references":["routing-transfer-one"]}'),'deferred');
RESET SESSION AUTHORIZATION;
INSERT INTO piggyvest_savings_ledger.bindings VALUES('33333333-3333-4333-8333-333333333399',
  'd91d9e87-8e0d-44de-9b84-1e1d709633d2','11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','projection_worker',true);
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_replay_routing(public.replay_routing_hints(
  '{"envelopeWalletId":"independent-legacy-wallet","destinationWalletId":"independent-legacy-wallet"}'),'deferred');
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_staging.integrations SET enabled=false WHERE id='d91d9e87-8e0d-44de-9b84-1e1d709633d2';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_replay_routing(public.replay_routing_hints(),'deferred');
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_staging.integrations SET enabled=true WHERE id='d91d9e87-8e0d-44de-9b84-1e1d709633d2';
SET SESSION AUTHORIZATION treasury_owner;
SELECT prefunded_card.provision_treasury_identity('50000000-0000-4000-8000-000000000099',
  'd91d9e87-8e0d-44de-9b84-1e1d709633d2','11111111-1111-4111-8111-111111111111',
  'business','sibling-treasury-wallet','projection_worker',50000);
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_replay_routing(public.replay_routing_hints(),'deferred');
SELECT public.assert_replay_routing(public.replay_routing_hints('{"references":["routing-transfer-one"]}'),'enrolled');
SELECT public.assert_replay_routing(public.replay_routing_hints('{"references":["routing-transfer-one"]}'),
  'deferred','{"treasury":"50000000-0000-4000-8000-000000000099"}');
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM prefunded_card.provider_evidence)
    OR EXISTS(SELECT 1 FROM public.customer_savings_contributions)
    OR (SELECT current_amount FROM public.customer_savings_goals WHERE id='33333333-3333-4333-8333-333333333333')<>0
    THEN RAISE EXCEPTION 'routing credited money or fabricated evidence'; END IF;
END $$;
ROLLBACK;
