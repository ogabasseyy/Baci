-- Task 5 only: private jobs/durable outputs. Does not enable publication or approvals.
ALTER TABLE public.experience_jobs ADD COLUMN connection_id uuid REFERENCES builder_authorization.connections(id),ADD COLUMN grant_version bigint;
CREATE INDEX experience_jobs_connection_idx ON public.experience_jobs(connection_id);
ALTER TABLE public.experience_builds ADD COLUMN host_origin text NOT NULL CHECK(host_origin ~ '^http://(127[.]0[.]0[.]1|localhost):[0-9]{4,5}$');
ALTER TABLE public.experience_evidence ADD COLUMN host_origin text NOT NULL CHECK(host_origin ~ '^http://(127[.]0[.]0[.]1|localhost):[0-9]{4,5}$');
CREATE ROLE baci_experience_verifier NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT USAGE ON SCHEMA public TO baci_experience_verifier;
GRANT INSERT(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) ON public.experience_evidence TO baci_experience_verifier;
CREATE POLICY verified_output_receipt ON public.experience_evidence FOR INSERT TO baci_experience_verifier WITH CHECK(true);
CREATE TABLE experience_authorization.build_replays(merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,retry_key uuid NOT NULL,payload text NOT NULL,build_id uuid NOT NULL REFERENCES public.experience_builds(id),PRIMARY KEY(merchant_id,retry_key));
CREATE INDEX experience_build_replays_build_idx ON experience_authorization.build_replays(build_id);
ALTER TABLE experience_authorization.build_replays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.build_replays FROM PUBLIC,anon,authenticated,service_role;
-- No role membership is granted to application users or sandbox jobs.
CREATE FUNCTION public.experience_queue_build(p_merchant uuid,p_connection uuid,p_version bigint,p_artifact uuid,p_retry uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.experience_artifacts; j public.experience_jobs;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 PERFORM pg_advisory_xact_lock(hashtextextended('experience-job:'||p_merchant::text,0));
 SELECT * INTO a FROM public.experience_artifacts WHERE id=p_artifact AND merchant_id=p_merchant;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO j FROM public.experience_jobs WHERE merchant_id=p_merchant AND retry_key=p_retry;
 IF FOUND THEN IF j.artifact_id<>p_artifact THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;RETURN j.id;END IF;
 IF (SELECT count(*) FROM public.experience_jobs WHERE merchant_id=p_merchant AND status IN('queued','running') AND expires_at>clock_timestamp())>=4 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
 INSERT INTO public.experience_jobs(merchant_id,artifact_id,retry_key,source_digest,connection_id,grant_version) VALUES(p_merchant,p_artifact,p_retry,a.source_digest,p_connection,p_version) RETURNING * INTO j;RETURN j.id;
END $$;
CREATE FUNCTION public.experience_finalize_build(p_merchant uuid,p_connection uuid,p_version bigint,p_job uuid,p_attempt uuid,p_source text,p_build text,p_receipt text,p_retry uuid,p_files jsonb,p_host_origin text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.experience_jobs; b uuid; f jsonb; raw bytea; total bigint:=0; js bytea; css bytea; replay experience_authorization.build_replays; payload text;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 SELECT * INTO j FROM public.experience_jobs WHERE id=p_job AND merchant_id=p_merchant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF j.connection_id IS NOT NULL THEN PERFORM public.builder_lock_connection(j.connection_id,j.grant_version,p_merchant,false);END IF;
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
 INSERT INTO public.experience_draft_heads VALUES(p_merchant,b,1) ON CONFLICT(merchant_id) DO UPDATE SET build_id=b,version=experience_draft_heads.version+1;
 INSERT INTO experience_authorization.build_replays VALUES(p_merchant,p_retry,payload,b);
 UPDATE public.experience_jobs SET status='finalized' WHERE id=p_job;
 RETURN b;
END $$;
CREATE FUNCTION public.experience_cancel_build(p_merchant uuid,p_connection uuid,p_version bigint,p_job uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 UPDATE public.experience_jobs SET status='cancelled',attempt_nonce=gen_random_uuid() WHERE id=p_job AND merchant_id=p_merchant AND status IN('queued','running');
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.experience_queue_build(uuid,uuid,bigint,uuid,uuid),public.experience_finalize_build(uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,jsonb,text),public.experience_cancel_build(uuid,uuid,bigint,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_queue_build(uuid,uuid,bigint,uuid,uuid),public.experience_finalize_build(uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,jsonb,text),public.experience_cancel_build(uuid,uuid,bigint,uuid) TO authenticated;
ALTER TABLE public.experience_jobs ADD COLUMN lease_expires_at timestamptz;
CREATE FUNCTION public.experience_claim_build(p_merchant uuid,p_connection uuid,p_version bigint,p_job uuid,p_attempt uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 UPDATE public.experience_jobs SET status='running',lease_expires_at=clock_timestamp()+interval '10 minutes'
 WHERE merchant_id=p_merchant AND id=p_job AND attempt_nonce=p_attempt AND status='queued' AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'BUILD_FAILED';END IF;
END $$;
CREATE FUNCTION public.experience_fail_build(p_merchant uuid,p_connection uuid,p_version bigint,p_job uuid,p_attempt uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 UPDATE public.experience_jobs SET status='failed',lease_expires_at=NULL WHERE merchant_id=p_merchant AND id=p_job AND attempt_nonce=p_attempt AND status='running';
END $$;
CREATE FUNCTION public.experience_retry_build(p_merchant uuid,p_connection uuid,p_version bigint,p_job uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 UPDATE public.experience_jobs SET status='queued',attempt_nonce=gen_random_uuid(),lease_expires_at=NULL,expires_at=clock_timestamp()+interval '24 hours'
 WHERE merchant_id=p_merchant AND id=p_job AND (status IN('failed','cancelled') OR (status='running' AND lease_expires_at<clock_timestamp())) RETURNING attempt_nonce INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'BUILD_FAILED';END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.experience_claim_build(uuid,uuid,bigint,uuid,uuid),public.experience_fail_build(uuid,uuid,bigint,uuid,uuid),public.experience_retry_build(uuid,uuid,bigint,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_claim_build(uuid,uuid,bigint,uuid,uuid),public.experience_fail_build(uuid,uuid,bigint,uuid,uuid),public.experience_retry_build(uuid,uuid,bigint,uuid) TO authenticated;
