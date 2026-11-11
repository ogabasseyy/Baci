-- Checkpoint D first boundary: private apply intents only. No publication authority.
-- Runtime enablement remains blocked until legacy writer/lease guards are qualified.
CREATE TABLE experience_authorization.apply_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id), connection_id uuid REFERENCES builder_authorization.connections(id), grant_version bigint,
 build_id uuid NOT NULL, evidence_id uuid NOT NULL REFERENCES public.experience_evidence(id), expected_version bigint NOT NULL CHECK(expected_version>=0),
 retry_key uuid NOT NULL, effect_digest text NOT NULL CHECK(effect_digest ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
 FOREIGN KEY(merchant_id,build_id) REFERENCES public.experience_builds(merchant_id,id),
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '10 minutes'),
 CHECK((connection_id IS NULL)=(grant_version IS NULL))
);
CREATE UNIQUE INDEX experience_apply_intent_retry ON experience_authorization.apply_intents(merchant_id,actor_user_id,coalesce(connection_id,'00000000-0000-0000-0000-000000000000'::uuid),retry_key);
CREATE INDEX experience_apply_intent_actor ON experience_authorization.apply_intents(actor_user_id);
CREATE INDEX experience_apply_intent_connection ON experience_authorization.apply_intents(connection_id);
CREATE INDEX experience_apply_intent_build ON experience_authorization.apply_intents(build_id);
CREATE INDEX experience_apply_intent_evidence ON experience_authorization.apply_intents(evidence_id);
ALTER TABLE experience_authorization.apply_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.apply_intents FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE experience_authorization.approval_checks(
 intent_id uuid PRIMARY KEY REFERENCES experience_authorization.apply_intents(id),effect_digest text NOT NULL CHECK(effect_digest ~ '^[a-f0-9]{64}$'),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL CHECK(expires_at>verified_at AND expires_at<=verified_at+interval '10 minutes')
);
ALTER TABLE experience_authorization.approval_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.approval_checks FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA experience_authorization TO baci_experience_verifier;
GRANT INSERT ON experience_authorization.approval_checks TO baci_experience_verifier;
CREATE POLICY independent_approval_check ON experience_authorization.approval_checks FOR INSERT TO baci_experience_verifier WITH CHECK(true);
-- Normal clients can request/read narrow projections, never edit intent authority.
CREATE FUNCTION experience_authorization.apply_effect(p_merchant uuid,p_build uuid,p_evidence uuid,p_expected bigint)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result text;
BEGIN
 SELECT encode(sha256(convert_to(jsonb_build_object(
 'namespace','baci.full-code.private-apply.v1','merchant',m.id,'website',v.token,
 'build',b.id,'buildDigest',b.build_digest,'runtime',b.host_origin,'outputs',b.output_manifest,
 'source',a.source_digest,'manifest',a.manifest,'evidence',e.id,'receipt',e.receipt_digest,
 'expected',p_expected,'draft',coalesce(h.version,0),
 'sourceHead',(SELECT jsonb_build_object('artifact',s.artifact_id,'version',s.version) FROM public.experience_source_heads s WHERE s.merchant_id=m.id),
 'assets',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.asset_id,'digest',x.digest,'mime',x.mime,'purpose',x.purpose) ORDER BY x.asset_id),'[]'::jsonb)
 FROM public.experience_assets x WHERE x.merchant_id=m.id AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(a.manifest->'assets','[]'::jsonb)) ref WHERE ref->>'assetId'=x.asset_id))
 )::text,'UTF8')),'hex') INTO result
 FROM public.merchants m JOIN public.experience_builds b ON b.merchant_id=m.id AND b.id=p_build
 JOIN public.experience_jobs j ON j.merchant_id=m.id AND j.id=b.job_id AND j.status='finalized'
 JOIN public.experience_artifacts a ON a.id=j.artifact_id AND a.merchant_id=m.id AND a.source_digest=j.source_digest
 JOIN public.experience_evidence e ON e.id=p_evidence AND e.merchant_id=m.id AND e.job_id=j.id AND e.attempt_nonce=j.attempt_nonce AND e.build_digest=b.build_digest AND e.host_origin=b.host_origin
 LEFT JOIN public.experience_draft_heads h ON h.merchant_id=m.id
 LEFT JOIN public.builder_website_revisions v ON v.merchant_id=m.id
 WHERE m.id=p_merchant AND coalesce(h.version,0)=p_expected
 AND (NOT EXISTS(SELECT 1 FROM public.experience_source_heads s WHERE s.merchant_id=m.id)
   OR EXISTS(SELECT 1 FROM public.experience_source_heads s WHERE s.merchant_id=m.id AND s.artifact_id=a.id))
 AND NOT EXISTS(SELECT 1 FROM public.experience_build_files f WHERE f.merchant_id=m.id AND f.build_id=b.id AND f.digest<>encode(sha256(f.bytes),'hex'))
 AND (SELECT count(*) FROM public.experience_build_files f WHERE f.merchant_id=m.id AND f.build_id=b.id AND f.path IN('app.js','app.css'))=2
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(a.manifest->'assets','[]'::jsonb)) ref WHERE NOT EXISTS(
 SELECT 1 FROM public.experience_assets x WHERE x.merchant_id=m.id AND x.asset_id=ref->>'assetId' AND x.purpose='design' AND x.digest=encode(sha256(x.bytes),'hex')));
 IF result IS NULL THEN RAISE EXCEPTION 'STALE_OR_UNVERIFIED_BUILD'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION experience_authorization.apply_effect(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.experience_request_draft_apply(p_merchant uuid,p_connection uuid,p_version bigint,p_build uuid,p_evidence uuid,p_expected bigint,p_retry uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i experience_authorization.apply_intents; effect text;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 PERFORM public.builder_website_guard(p_merchant);
 PERFORM 1 FROM public.merchants WHERE id=p_merchant FOR UPDATE;
 IF p_retry IS NULL OR p_expected IS NULL OR p_expected<0 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO i FROM experience_authorization.apply_intents WHERE merchant_id=p_merchant AND actor_user_id=auth.uid() AND connection_id IS NOT DISTINCT FROM p_connection AND retry_key=p_retry;
 IF FOUND THEN
  IF i.build_id IS DISTINCT FROM p_build OR i.evidence_id IS DISTINCT FROM p_evidence OR i.expected_version IS DISTINCT FROM p_expected OR i.grant_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  -- Reconciliation returns the original intent, never silently renews an expired one.
 ELSE
  effect:=experience_authorization.apply_effect(p_merchant,p_build,p_evidence,p_expected);
  IF (SELECT count(*) FROM experience_authorization.apply_intents WHERE merchant_id=p_merchant AND expires_at>clock_timestamp())>=32 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED';END IF;
  INSERT INTO experience_authorization.apply_intents(merchant_id,actor_user_id,connection_id,grant_version,build_id,evidence_id,expected_version,retry_key,effect_digest)
  VALUES(p_merchant,auth.uid(),p_connection,p_version,p_build,p_evidence,p_expected,p_retry,effect) RETURNING * INTO i;
 END IF;
 RETURN jsonb_build_object('approvalId',i.id,'effectDigest',i.effect_digest,'expiresAt',i.expires_at,'status','confirmation-required');
END $$;
REVOKE ALL ON FUNCTION public.experience_request_draft_apply(uuid,uuid,bigint,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_request_draft_apply(uuid,uuid,bigint,uuid,uuid,bigint,uuid) TO authenticated;
CREATE FUNCTION public.experience_load_draft_approval(p_intent uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i experience_authorization.apply_intents; current_effect text;
BEGIN
 SELECT * INTO i FROM experience_authorization.apply_intents WHERE id=p_intent AND actor_user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM public.experience_require_owner(i.merchant_id,i.connection_id,i.grant_version);
 PERFORM public.builder_website_guard(i.merchant_id);
 IF i.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'APPROVAL_EXPIRED';END IF;
 current_effect:=experience_authorization.apply_effect(i.merchant_id,i.build_id,i.evidence_id,i.expected_version);
 IF current_effect<>i.effect_digest THEN RAISE EXCEPTION 'APPROVAL_MISMATCH';END IF;
 RETURN jsonb_build_object('approvalId',i.id,'merchantId',i.merchant_id,'buildId',i.build_id,'evidenceId',i.evidence_id,'effectDigest',i.effect_digest,'expectedVersion',i.expected_version,'expiresAt',i.expires_at,'status','confirmation-required');
END $$;
REVOKE ALL ON FUNCTION public.experience_load_draft_approval(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_load_draft_approval(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.experience_finalize_build(p_merchant uuid,p_connection uuid,p_version bigint,p_job uuid,p_attempt uuid,p_source text,p_build text,p_receipt text,p_retry uuid,p_files jsonb,p_host_origin text)
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
 -- Finalization retains a private candidate only. Owner confirmation alone advances the draft head.
 INSERT INTO experience_authorization.build_replays VALUES(p_merchant,p_retry,payload,b);
 UPDATE public.experience_jobs SET status='finalized' WHERE id=p_job;
 RETURN b;
END $$;
-- A separate installed guard owns native/worker lease exclusion. Until Task14
-- installs it, confirmation fails closed instead of exposing an unsafe mode entry.
CREATE FUNCTION public.experience_confirm_draft_apply(p_intent uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i experience_authorization.apply_intents; loaded jsonb;
BEGIN
 loaded:=public.experience_load_draft_approval(p_intent);
 SELECT * INTO i FROM experience_authorization.apply_intents WHERE id=p_intent FOR UPDATE;
 -- No implicit runtime qualification, owner boolean or client setter exists.
 RAISE EXCEPTION 'RUNTIME_NOT_QUALIFIED';
END $$;
REVOKE ALL ON FUNCTION public.experience_confirm_draft_apply(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_confirm_draft_apply(uuid) TO authenticated;

CREATE FUNCTION experience_authorization.guard_effect_dependency() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.builder_website_guard(coalesce(NEW.merchant_id,OLD.merchant_id));
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION experience_authorization.guard_effect_dependency() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION experience_authorization.guard_effect_dependency() TO authenticated;
CREATE TRIGGER experience_source_head_guard BEFORE INSERT OR UPDATE OR DELETE ON public.experience_source_heads FOR EACH ROW EXECUTE FUNCTION experience_authorization.guard_effect_dependency();
CREATE TRIGGER experience_asset_effect_guard BEFORE INSERT OR UPDATE OR DELETE ON public.experience_assets FOR EACH ROW EXECUTE FUNCTION experience_authorization.guard_effect_dependency();
