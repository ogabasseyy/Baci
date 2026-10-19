SELECT authorization_test.assert(
  to_regprocedure('prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text)') IS NOT NULL,
  'the actual restricted resolver is installed');
GRANT USAGE ON SCHEMA prefunded_card TO authorization_provisioner, authorization_worker, authorization_other_worker;
GRANT EXECUTE ON FUNCTION prefunded_card.authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text),
  prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)
  TO prefunded_card_authorization_provisioner;
GRANT EXECUTE ON FUNCTION prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text)
  TO prefunded_card_authorization_reader;
GRANT EXECUTE ON FUNCTION prefunded_card.claim_collection(uuid,bigint) TO authorization_worker;
GRANT USAGE ON SCHEMA prefunded_card TO authorization_untrusted;
GRANT EXECUTE ON FUNCTION prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)
  TO authorization_untrusted;

CREATE FUNCTION authorization_test.provision(proof jsonb DEFAULT authorization_test.proof()) RETURNS jsonb LANGUAGE sql AS $$
  SELECT prefunded_card.provision_authorization(authorization_test.id(5),authorization_test.id(4),
    authorization_test.id(1),authorization_test.id(2),authorization_test.id(6),authorization_test.id(7),
    (SELECT identifier FROM authorization_test.database_pin),proof);
$$;
CREATE FUNCTION authorization_test.read_method() RETURNS jsonb LANGUAGE sql AS $$
  SELECT prefunded_card.read_authorization(authorization_test.id(5),authorization_test.id(4),
    authorization_test.id(1),authorization_test.id(2),authorization_test.id(6),
    (SELECT identifier FROM authorization_test.database_pin));
$$;

SET SESSION AUTHORIZATION authorization_provisioner;
SELECT authorization_test.denied($q$SELECT authorization_test.provision(jsonb_set(authorization_test.proof(),'{domain}','"live"'))$q$);
SELECT authorization_test.denied($q$SELECT authorization_test.provision(authorization_test.proof()-'domain')$q$);
SELECT authorization_test.denied($q$SELECT authorization_test.provision(jsonb_set(authorization_test.proof(),'{metadata,customer_id}','"20000000-0000-4000-8000-000000000002"'))$q$);
SELECT authorization_test.denied($q$SELECT authorization_test.provision(jsonb_set(authorization_test.proof(),'{metadata,merchant_slug}','"other-merchant"'))$q$);
SELECT authorization_test.denied($q$SELECT authorization_test.provision(jsonb_set(authorization_test.proof(),'{customer,email}','"other@example.test"'))$q$);
SELECT authorization_test.denied($q$SELECT authorization_test.provision(jsonb_set(authorization_test.proof(),'{authorization,authorization_code}','"AUTH_other"'))$q$);
SELECT authorization_test.denied($q$SELECT authorization_test.provision(jsonb_set(authorization_test.proof(),'{authorization,reusable}','false'))$q$);
SELECT authorization_test.denied($q$SELECT authorization_test.provision(jsonb_set(authorization_test.proof(),'{amount}','1'))$q$);
SELECT authorization_test.denied($q$SELECT authorization_test.provision(jsonb_set(authorization_test.proof(),'{customer,customer_code}','" "'))$q$);
SELECT authorization_test.assert(authorization_test.provision()->>'outcome'='provisioned','verified receipt provisions');
SELECT authorization_test.assert(authorization_test.provision()->>'outcome'='duplicate','same proof is idempotent');
SELECT authorization_test.denied($q$SELECT authorization_test.provision(jsonb_set(authorization_test.proof(),'{customer,customer_code}','"CUS_substituted"'))$q$);
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION authorization_worker;
SELECT authorization_test.assert(authorization_test.read_method()=jsonb_build_object(
  'savedMethodId',authorization_test.id(6),'merchantId',authorization_test.id(1),
  'customerId',authorization_test.id(2),'email','original@example.test',
  'authorizationCode','AUTH_synthetic','paystackCustomerCode','CUS_synthetic',
  'domain','test','reusable',true,'active',true),'read returns independent stored identity');
SELECT authorization_test.denied('SELECT authorization_test.provision()');
SELECT authorization_test.denied('SELECT authorization_code FROM prefunded_card.authorization_bindings');
SELECT authorization_test.denied($q$SELECT prefunded_card.read_authorization(authorization_test.id(5),authorization_test.id(4),authorization_test.id(8),authorization_test.id(2),authorization_test.id(6),(SELECT identifier FROM authorization_test.database_pin))$q$);
SELECT authorization_test.denied($q$SELECT prefunded_card.read_authorization(authorization_test.id(5),authorization_test.id(4),authorization_test.id(1),authorization_test.id(8),authorization_test.id(6),(SELECT identifier FROM authorization_test.database_pin))$q$);
SELECT authorization_test.denied($q$SELECT prefunded_card.read_authorization(authorization_test.id(5),authorization_test.id(4),authorization_test.id(1),authorization_test.id(2),authorization_test.id(6),'0')$q$);
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION authorization_other_worker;
SELECT authorization_test.denied('SELECT authorization_test.read_method()');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION authorization_untrusted;
SET request.jwt.claims='{"role":"prefunded_card_authorization_provisioner"}';
SELECT authorization_test.denied('SELECT authorization_test.provision()');
RESET SESSION AUTHORIZATION;
REVOKE EXECUTE ON FUNCTION prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)
  FROM authorization_untrusted;
SET SESSION AUTHORIZATION authenticated;
SELECT authorization_test.denied('SELECT authorization_test.read_method()');
SELECT authorization_test.denied('SELECT authorization_test.provision()');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION service_role;
SELECT authorization_test.denied('SELECT authorization_test.read_method()');
SELECT authorization_test.denied('SELECT authorization_test.provision()');
RESET SESSION AUTHORIZATION;

BEGIN;
SET SESSION AUTHORIZATION authorization_worker;
SELECT authorization_test.assert(prefunded_card.claim_collection(authorization_test.id(8),0)->>'outcome'='claimed',
  'active control can claim through the actual operation function');
RESET SESSION AUTHORIZATION;
ROLLBACK;
UPDATE public.customer_saved_payment_methods SET is_active=false, reusable=false, disabled_at=clock_timestamp();
UPDATE public.transactions SET gateway_response='{}', metadata='{}';
SET SESSION AUTHORIZATION authorization_worker;
SELECT authorization_test.denied('SELECT prefunded_card.claim_collection(authorization_test.id(8),0)');
SELECT authorization_test.assert(authorization_test.read_method()->>'active'='false'
  AND authorization_test.read_method()->>'reusable'='false'
  AND authorization_test.read_method()->>'authorizationCode'='AUTH_synthetic'
  AND authorization_test.read_method()->>'paystackCustomerCode'='CUS_synthetic',
  'revoked method retains immutable historical authorization');
RESET SESSION AUTHORIZATION;
SELECT authorization_test.assert((SELECT collection_status='not_started' AND collection_fence=0
  FROM prefunded_card.operations WHERE id=authorization_test.id(8)),
  'revoked method cannot advance the send fence or enter unknown');

UPDATE public.customer_saved_payment_methods SET is_active=true,reusable=true,disabled_at=NULL,
  customer_id=authorization_test.id(8),authorization_code='AUTH_changed',provider_customer_email='changed@example.test';
SET SESSION AUTHORIZATION authorization_worker;
SELECT authorization_test.assert(authorization_test.read_method()->>'active'='false'
  AND authorization_test.read_method()->>'authorizationCode'='AUTH_synthetic'
  AND authorization_test.read_method()->>'customerId'=authorization_test.id(2)::text,
  'changed public ownership cannot redirect the original authorization');
RESET SESSION AUTHORIZATION;
DELETE FROM public.customer_saved_payment_methods;
SET SESSION AUTHORIZATION authorization_worker;
SELECT authorization_test.assert(authorization_test.read_method()->>'active'='false'
  AND authorization_test.read_method()->>'authorizationCode'='AUTH_synthetic',
  'removed card retains a verification-only snapshot');
RESET SESSION AUTHORIZATION;
SELECT authorization_test.denied('UPDATE prefunded_card.authorization_bindings SET domain=''live''');
SELECT authorization_test.denied('DELETE FROM prefunded_card.authorization_bindings');
SELECT authorization_test.denied('TRUNCATE prefunded_card.authorization_bindings');
SELECT authorization_test.assert(NOT has_table_privilege('authorization_worker','prefunded_card.authorization_bindings','SELECT'),
  'workers have only scoped function access');
INSERT INTO public.customer_saved_payment_methods VALUES(authorization_test.id(9),authorization_test.id(1),
  authorization_test.id(2),'paystack','unused@example.test','AUTH_unused','SIG_unused','{}',true,true,NULL);
SELECT authorization_fixture.seed(authorization_test.id(5),authorization_test.id(9));
SET SESSION AUTHORIZATION authorization_worker;
SELECT authorization_test.assert(prefunded_card.read_authorization(authorization_test.id(5),authorization_test.id(4),
  authorization_test.id(1),authorization_test.id(2),authorization_test.id(9),
  (SELECT identifier FROM authorization_test.database_pin))->>'active'='true',
  'composable synthetic fixture produces the same worker read shape');
RESET SESSION AUTHORIZATION;
