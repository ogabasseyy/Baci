CREATE FUNCTION ledger_test.snapshot() RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_savings_ledger.snapshot(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
$$;
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT ledger_test.reject(ledger_test.command(80,'credit_principal',1), 'ledger requires read committed');
ROLLBACK;
DO $$
DECLARE snapshot jsonb; role_name text; relation regclass; routine regprocedure;
BEGIN
  snapshot := ledger_test.snapshot();
  IF snapshot <> '{"ledger":{"confirmedPrincipalKobo":50,"reservedPrincipalKobo":0,
    "paidEligibleInterestKobo":0,"reservedPaidInterestKobo":0,"pendingInterestKobo":900},
    "activeReservation":null,"fundingReversed":true}'::jsonb THEN RAISE EXCEPTION 'snapshot mismatch: %', snapshot; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','ledger_caller'] LOOP
    IF has_schema_privilege(role_name,'piggyvest_savings_ledger','USAGE') THEN RAISE EXCEPTION 'schema access leaked'; END IF;
    FOR relation IN SELECT oid FROM pg_class WHERE relnamespace = 'piggyvest_savings_ledger'::regnamespace AND relkind = 'r' LOOP
      IF has_table_privilege(role_name,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'table access leaked'; END IF;
    END LOOP;
    FOR routine IN SELECT oid FROM pg_proc WHERE pronamespace = 'piggyvest_savings_ledger'::regnamespace LOOP
      IF has_function_privilege(role_name,routine,'EXECUTE') THEN RAISE EXCEPTION 'function access leaked'; END IF;
    END LOOP;
  END LOOP;
  BEGIN
    UPDATE piggyvest_savings_ledger.postings SET amount_kobo = 1;
    RAISE EXCEPTION 'mutable postings';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    DELETE FROM piggyvest_savings_ledger.operations;
    RAISE EXCEPTION 'mutable operations';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    TRUNCATE piggyvest_savings_ledger.postings;
    RAISE EXCEPTION 'truncatable postings';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO piggyvest_savings_ledger.postings VALUES ('50000000-0000-4000-8000-000000000001','paid_interest',1);
    RAISE EXCEPTION 'append to committed journal';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM ledger_test.reject(ledger_test.command(80,'credit_principal',1) || '{"principalKobo":0.1}', 'ledger invalid command');
  PERFORM ledger_test.reject(ledger_test.command(80,'credit_principal',1) || '{"event":"deposit"}', 'ledger invalid command');
  PERFORM ledger_test.reject(ledger_test.command(80,'credit_principal',1) || '{"principalKobo":null}', 'ledger invalid command');
  PERFORM ledger_test.reject(ledger_test.command(80,'credit_principal',1) || '{"principalKobo":"1"}', 'ledger invalid command');
  PERFORM ledger_test.reject(ledger_test.command(80,'credit_principal',1) || '{"principalKobo":9007199254740992}', 'ledger invalid command');
  PERFORM ledger_test.reject(ledger_test.command(80,'credit_principal',1) || '{"evidenceId":"synthetic-1"}', 'ledger idempotency conflict');
  PERFORM ledger_test.reject(ledger_test.command(80,'credit_principal',9007199254740991), 'ledger balance overflow');
  UPDATE piggyvest_savings_ledger.bindings SET enabled = false;
  PERFORM ledger_test.reject(ledger_test.command(80,'credit_principal',1), 'ledger caller or binding denied');
  UPDATE piggyvest_savings_ledger.bindings SET enabled = true;
  UPDATE piggyvest_staging.integrations SET enabled = false;
  PERFORM ledger_test.reject(ledger_test.command(80,'credit_principal',1), 'ledger integration disabled');
  PERFORM ledger_test.reject(ledger_test.command(1,'credit_principal',1000), 'ledger integration disabled');
  PERFORM ledger_test.reject(ledger_test.command(80,'reverse_credit',0,0,14), 'ledger integration disabled');
  BEGIN
    PERFORM ledger_test.snapshot();
    RAISE EXCEPTION 'disabled integration snapshot';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_staging.integrations SET enabled = true;
END $$;
BEGIN;
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000002');
UPDATE public.customers SET merchant_id = '10000000-0000-4000-8000-000000000002';
SELECT ledger_test.reject(ledger_test.command(80,'credit_principal',1), 'ledger ownership mismatch');
ROLLBACK;
BEGIN;
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000002');
UPDATE public.customer_savings_goals SET merchant_id = '10000000-0000-4000-8000-000000000002';
SELECT ledger_test.reject(ledger_test.command(80,'credit_principal',1), 'ledger ownership mismatch');
ROLLBACK;
DO $$
BEGIN
  BEGIN
    INSERT INTO piggyvest_savings_ledger.operations(id,integration_id,merchant_id,customer_id,goal_id,command,evidence_id)
    VALUES ('50000000-0000-4000-8000-000000000099', '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001', ledger_test.command(99,'credit_principal',1), 'synthetic-unbalanced');
    INSERT INTO piggyvest_savings_ledger.postings VALUES ('50000000-0000-4000-8000-000000000099','principal',1);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'unbalanced commit permitted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF EXISTS (SELECT 1 FROM piggyvest_savings_ledger.operations WHERE evidence_id = 'synthetic-unbalanced') THEN
    RAISE EXCEPTION 'partial journal persisted';
  END IF;
END $$;
GRANT USAGE ON SCHEMA piggyvest_savings_ledger, ledger_test TO ledger_caller;
GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb),
  piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid) TO ledger_caller;
SET SESSION AUTHORIZATION ledger_caller;
SELECT ledger_test.reject(ledger_test.command(80,'credit_principal',1), 'ledger caller or binding denied');
DO $$
BEGIN
  BEGIN
    PERFORM ledger_test.snapshot();
    RAISE EXCEPTION 'foreign snapshot allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO piggyvest_savings_ledger.postings VALUES ('50000000-0000-4000-8000-000000000001','paid_interest',1);
    RAISE EXCEPTION 'caller table write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
SELECT ledger_test.reject(ledger_test.command(82,'reverse_credit',0,0,81), 'ledger invalid reference');
INSERT INTO public.customer_savings_goals VALUES ('30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
INSERT INTO piggyvest_savings_ledger.bindings
  (integration_id,merchant_id,customer_id,goal_id,authorized_login,enabled)
VALUES ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','ledger_caller',true);
SET SESSION AUTHORIZATION ledger_caller;
SELECT piggyvest_savings_ledger.apply('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',ledger_test.command(81,'credit_principal',1));
SELECT piggyvest_savings_ledger.snapshot('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
RESET SESSION AUTHORIZATION;
