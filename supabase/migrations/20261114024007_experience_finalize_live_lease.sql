-- Bind finalization and replay to the job admission grant.
CREATE OR REPLACE FUNCTION public.experience_finalize_build(p_merchant uuid,p_connection uuid,p_version bigint,p_job uuid,p_attempt uuid,p_source text,p_build text,p_receipt text,p_retry uuid,p_files jsonb,p_host_origin text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.experience_jobs; b uuid; f jsonb; raw bytea; total bigint:=0; js bytea; css bytea; replay experience_authorization.build_replays; payload text;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 SELECT * INTO j FROM public.experience_jobs WHERE id=p_job AND merchant_id=p_merchant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF j.connection_id IS DISTINCT FROM p_connection OR j.grant_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'BUILD_FAILED'; END IF;
 IF j.connection_id IS NOT NULL THEN PERFORM public.builder_lock_connection(j.connection_id,j.grant_version,p_merchant,false);END IF;
 IF j.connection_id IS NOT NULL AND j.status='running' AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'BUILD_FAILED'; END IF;
 payload:=encode(sha256(convert_to(jsonb_build_object('job',p_job,'attempt',p_attempt,'source',p_source,'build',p_build,'receipt',p_receipt,'files',p_files,'hostOrigin',p_host_origin)::text,'UTF8')),'hex');
 SELECT * INTO replay FROM experience_authorization.build_replays WHERE merchant_id=p_merchant AND retry_key=p_retry;
 IF FOUND THEN IF replay.payload<>payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN replay.build_id;END IF;
 IF j.source_digest<>p_source OR j.attempt_nonce<>p_attempt OR j.status NOT IN('running','finalized') OR NOT EXISTS(SELECT 1 FROM public.experience_evidence WHERE job_id=p_job AND merchant_id=p_merchant AND attempt_nonce=p_attempt AND build_digest=p_build AND receipt_digest=p_receipt AND host_origin=p_host_origin) THEN RAISE EXCEPTION 'BUILD_FAILED'; END IF;
 SELECT id INTO b FROM public.experience_builds WHERE job_id=p_job AND merchant_id=p_merchant AND build_digest=p_build;
 IF b IS NOT NULL THEN INSERT INTO experience_authorization.build_replays VALUES(p_merchant,p_retry,payload,b);RETURN b; END IF;
 IF j.expires_at<=clock_timestamp() OR jsonb_typeof(p_files)<>'array' OR jsonb_array_length(p_files)<>2 THEN RAISE EXCEPTION 'BUILD_FAILED'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_files) LOOP
 IF f->>'path' NOT IN('app.js','app.css') OR length(f->>'bytes')>33554432 OR f->>'bytes' !~ '^[a-f0-9]*$' OR length(f->>'bytes')%2<>0 THEN RAISE EXCEPTION 'BUILD_FAILED'; END IF;
 raw:=decode(f->>'bytes','hex');total:=total+octet_length(raw);
 IF encode(sha256(raw),'hex')<>f->>'digest' OR total>16777216 THEN RAISE EXCEPTION 'BUILD_FAILED'; END IF;
 IF f->>'path'='app.js' THEN IF js IS NOT NULL OR f->>'mime'<>'text/javascript' THEN RAISE EXCEPTION 'BUILD_FAILED'; END IF;js:=raw;
 ELSE IF css IS NOT NULL OR f->>'mime'<>'text/css' THEN RAISE EXCEPTION 'BUILD_FAILED'; END IF;css:=raw;END IF;
 END LOOP;
 IF js IS NULL OR css IS NULL OR octet_length(js)=0 OR encode(sha256(js||decode('00','hex')||css),'hex')<>p_build THEN RAISE EXCEPTION 'BUILD_FAILED'; END IF;
 INSERT INTO public.experience_builds(merchant_id,job_id,build_digest,output_manifest,host_origin) VALUES(p_merchant,p_job,p_build,(SELECT jsonb_agg(value-'bytes') FROM jsonb_array_elements(p_files)),p_host_origin) RETURNING id INTO b;
 INSERT INTO public.experience_build_files(merchant_id,build_id,path,digest,bytes,mime) SELECT p_merchant,b,value->>'path',value->>'digest',decode(value->>'bytes','hex'),value->>'mime' FROM jsonb_array_elements(p_files);
 -- Finalization retains a private candidate only. Owner confirmation alone advances the draft head.
 INSERT INTO experience_authorization.build_replays VALUES(p_merchant,p_retry,payload,b);
 UPDATE public.experience_jobs SET status='finalized' WHERE id=p_job;
 RETURN b;
END $$;
