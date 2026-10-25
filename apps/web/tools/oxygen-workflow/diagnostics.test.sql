-- Included by runtime.test.sql in its disposable transaction.
RESET ROLE;
DO $$ DECLARE w uuid; cmd uuid:=gen_random_uuid(); before_version int; rows jsonb; item jsonb;
BEGIN
 SELECT id,version INTO w,before_version FROM public.oxygen_workflows WHERE merchant_id='10000000-0000-4000-8000-000000000001';
 INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
 VALUES(cmd,w,gen_random_uuid(),before_version,'web','{"action":"book","equityPercentage":25,"tenure":3}','executing');
 item:=jsonb_build_object('operation','book','kind','http','outcome','rejected','httpStatus',400,
  'providerCode','STATEMENT_REQUIRED','providerMessage','User does not have a valid statement',
  'providerRequestId',null,'capture','parsed','occurredAt',now(),'durationMs',10);
 PERFORM set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
 BEGIN
  PERFORM public.oxygen_finish_failure(cmd,'failed','plan_required',item);
  RAISE EXCEPTION 'Customer wrote evidence';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.oxygen_error_report(w); RAISE EXCEPTION 'Customer read evidence';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
 BEGIN
  PERFORM public.oxygen_error_report(w); RAISE EXCEPTION 'Foreign worker read evidence';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.oxygen_finish_failure(cmd,'failed','plan_required',item);
  RAISE EXCEPTION 'Foreign worker wrote evidence';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
 BEGIN
  PERFORM public.oxygen_finish_failure(cmd,'failed','plan_required',item||'{"rawBody":"private"}'::jsonb);
  RAISE EXCEPTION 'Unknown raw body retained';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF (SELECT status FROM oxygen_private.commands WHERE id=cmd)<>'executing' THEN RAISE EXCEPTION 'Invalid evidence committed failure'; END IF;
 PERFORM public.oxygen_finish_failure(cmd,'failed','plan_required',item);
 IF (SELECT status FROM oxygen_private.commands WHERE id=cmd)<>'failed' THEN RAISE EXCEPTION 'Failed status not committed'; END IF;
 IF (SELECT version FROM public.oxygen_workflows WHERE id=w)<>before_version+1 THEN RAISE EXCEPTION 'Version mismatch'; END IF;
 rows:=public.oxygen_error_report(w);
 IF jsonb_array_length(rows)<>1 OR rows->0->'diagnostic'->>'httpStatus'<>'400' THEN RAISE EXCEPTION 'Evidence missing'; END IF;
 IF rows->0->>'commandId'<>cmd::text THEN RAISE EXCEPTION 'Wrong attempt linked'; END IF;
 UPDATE oxygen_private.attempt_diagnostics SET expires_at=now()-interval '1 day' WHERE command_id=cmd;
 IF jsonb_array_length(public.oxygen_error_report(w))<>0 THEN RAISE EXCEPTION 'Expired evidence visible'; END IF;
 IF has_table_privilege('authenticated','oxygen_private.attempt_diagnostics','SELECT') OR has_table_privilege('anon','oxygen_private.attempt_diagnostics','SELECT') THEN RAISE EXCEPTION 'Evidence table exposed'; END IF;
END $$;
\echo 'PASS: evidence atomicity, expiry, strict projection, customer and cross-worker denial'
