-- Same-key recovery replays a stored terminal stale result without applying again.
CREATE OR REPLACE FUNCTION public.builder_apply_operation(p_connection uuid,p_version bigint,p_merchant uuid,p_operation uuid,p_expected uuid,p_retry_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o builder_authorization.builder_edit_operations%ROWTYPE; result jsonb;
 digest text:=encode(sha256(convert_to(jsonb_build_object('operation',p_operation,'expected',p_expected,'retry',p_retry_key)::text,'UTF8')),'hex');
BEGIN
 o:=builder_authorization.lock_edit(p_connection,p_version,p_merchant,p_operation);
 IF p_retry_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF EXISTS(SELECT 1 FROM builder_authorization.builder_edit_operations WHERE connection_id=p_connection AND actor_user_id=auth.uid() AND apply_retry_key=p_retry_key AND id<>p_operation) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 IF o.status='applied' OR (o.status='conflict' AND o.applied_result->>'code'='STALE_DRAFT') THEN
  IF o.apply_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  RETURN o.applied_result;
 END IF;
 IF o.status<>'ready' OR o.source_version IS DISTINCT FROM p_expected OR o.candidate_digest IS DISTINCT FROM builder_authorization.edit_candidate_digest(o.id,o.source_version,o.candidate) THEN RAISE EXCEPTION 'OPERATION_FAILED';END IF;
 result:=public.builder_commit_draft(p_connection,p_version,p_merchant,p_expected,p_retry_key,o.candidate);
 UPDATE builder_authorization.builder_edit_operations SET status=CASE WHEN result->>'code'='STALE_DRAFT' THEN 'conflict' ELSE 'applied' END,applied_result=result,apply_digest=digest,apply_retry_key=p_retry_key WHERE id=o.id;
 RETURN result;
END $$;

-- Let the service reach the exact-digest replay check without revalidating a terminal candidate.
CREATE OR REPLACE FUNCTION public.builder_prepare_apply(p_connection uuid,p_version bigint,p_merchant uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o builder_authorization.builder_edit_operations%ROWTYPE;
BEGIN
 o:=builder_authorization.lock_edit(p_connection,p_version,p_merchant,p_operation);
 IF o.status='applied' OR (o.status='conflict' AND o.applied_result->>'code'='STALE_DRAFT') THEN RETURN NULL; END IF;
 IF o.status<>'ready' OR o.candidate_digest IS DISTINCT FROM builder_authorization.edit_candidate_digest(o.id,o.source_version,o.candidate) THEN RAISE EXCEPTION 'OPERATION_FAILED';END IF;
 RETURN jsonb_build_object('sourceConfig',o.source_config,'candidate',o.candidate,'candidateDigest',o.candidate_digest);
END $$;
