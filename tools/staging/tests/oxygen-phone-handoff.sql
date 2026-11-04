-- Isolated staging only. All synthetic state and DDL are rolled back by the caller.
DO $$
DECLARE wf uuid:='1c0459fe-2d45-4d2c-b41a-0ac640ad9f89'; owner_id uuid; worker_id uuid;
 app uuid:='60000000-0000-4000-8000-000000000002'; payload jsonb; result jsonb;
BEGIN
 IF has_table_privilege('anon','oxygen_private.phone_handoffs','SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege('authenticated','oxygen_private.phone_handoffs','SELECT,INSERT,UPDATE,DELETE') THEN
  RAISE EXCEPTION 'Direct handoff table access granted'; END IF;
 IF has_function_privilege('anon','public.oxygen_phone_handoff(text,uuid,text,jsonb)','EXECUTE')
 OR has_function_privilege('anon','oxygen_private.phone_handoff(text,uuid,text,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Anonymous handoff RPC access granted'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='oxygen_private.phone_handoffs'::regclass) THEN
  RAISE EXCEPTION 'Handoff RLS disabled'; END IF;
 SELECT c.user_id,b.worker_user_id INTO owner_id,worker_id FROM public.oxygen_workflows w
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id WHERE w.id=wf AND w.environment='staging';
 IF owner_id IS NULL OR worker_id IS NULL THEN RAISE EXCEPTION 'Missing isolated fixture'; END IF;
 UPDATE public.oxygen_workflows SET stage='kyc_required' WHERE id=wf;
 UPDATE oxygen_private.provider_states SET state=jsonb_build_object('applicationReference',app,'validated',true) WHERE workflow_id=wf;
 payload:=jsonb_build_object('applicationReference',app,'ciphertext','synthetic-encrypted-target','expiresAt',clock_timestamp()+interval '4 minutes');
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 BEGIN
  PERFORM public.oxygen_phone_handoff('issue',wf,repeat('a',64),payload); RAISE EXCEPTION 'Outsider issued capability';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM public.oxygen_phone_handoff('issue',wf,repeat('a',64),payload);
 BEGIN
  PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('a',64),'{}'); RAISE EXCEPTION 'Owner bypassed restricted redemption';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',worker_id::text,true);
 result:=public.oxygen_phone_handoff('consume',NULL,repeat('a',64),'{}');
 IF result->>'ciphertext'<>'synthetic-encrypted-target' THEN RAISE EXCEPTION 'Wrong consumed payload'; END IF;
 BEGIN
  PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('a',64),'{}'); RAISE EXCEPTION 'Replay accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM public.oxygen_phone_handoff('issue',wf,repeat('b',64),payload);
 PERFORM public.oxygen_phone_handoff('issue',wf,repeat('c',64),payload);
 PERFORM set_config('request.jwt.claim.sub',worker_id::text,true);
 BEGIN
  PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('b',64),'{}'); RAISE EXCEPTION 'Revoked QR accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 UPDATE oxygen_private.phone_handoffs SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=repeat('c',64);
 BEGIN
  PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('c',64),'{}'); RAISE EXCEPTION 'Expired QR accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM public.oxygen_phone_handoff('issue',wf,repeat('d',64),payload);
 UPDATE oxygen_private.provider_states SET state=state||jsonb_build_object('applicationReference',gen_random_uuid()) WHERE workflow_id=wf;
 PERFORM set_config('request.jwt.claim.sub',worker_id::text,true);
 BEGIN
  PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('d',64),'{}'); RAISE EXCEPTION 'Changed application accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 RAISE NOTICE 'PASS: RLS and privileges, owner scope, worker boundary, single use, replacement revocation, expiry and application binding';
END $$;
