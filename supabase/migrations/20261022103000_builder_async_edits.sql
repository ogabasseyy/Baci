-- Private state machine. JWT/Data API clients never receive raw PostgreSQL credentials.
-- Ordinary installation remains inactive until the coordinated Task4 cutover.
ALTER TABLE public.builder_edit_operations SET SCHEMA builder_authorization;
ALTER TABLE builder_authorization.builder_edit_operations
 ADD COLUMN retry_key uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN input_digest text NOT NULL DEFAULT '',
 ADD COLUMN source_config jsonb,
 ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN applied_result jsonb,
 ADD COLUMN candidate_digest text,
 ADD COLUMN apply_digest text,
 ADD COLUMN apply_retry_key uuid;
CREATE UNIQUE INDEX builder_edit_apply_retry_idx ON builder_authorization.builder_edit_operations(actor_user_id,connection_id,apply_retry_key);
CREATE UNIQUE INDEX builder_edit_retry_idx ON builder_authorization.builder_edit_operations(actor_user_id,connection_id,retry_key);
CREATE INDEX builder_edit_due_idx ON builder_authorization.builder_edit_operations(connection_id,next_attempt_at) WHERE status IN('pending','running');
CREATE POLICY builder_operations_mutate ON builder_authorization.builder_edit_operations FOR ALL TO authenticated
 USING(actor_user_id=auth.uid() AND EXISTS(SELECT 1 FROM builder_authorization.connections c WHERE c.id=connection_id AND c.actor_user_id=auth.uid() AND c.status='active' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND c.grant_version=builder_edit_operations.grant_version AND 'storefront.write'=ANY(c.scopes) AND merchant_id=ANY(c.allowed_merchant_ids)))
 WITH CHECK(actor_user_id=auth.uid() AND EXISTS(SELECT 1 FROM builder_authorization.connections c WHERE c.id=connection_id AND c.actor_user_id=auth.uid() AND c.status='active' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND c.grant_version=builder_edit_operations.grant_version AND 'storefront.write'=ANY(c.scopes) AND merchant_id=ANY(c.allowed_merchant_ids)));
REVOKE ALL ON builder_authorization.builder_edit_operations FROM PUBLIC,anon,authenticated,service_role,baci_builder_auth_storage;
GRANT SELECT,INSERT,UPDATE ON builder_authorization.builder_edit_operations TO authenticated;
-- Durable per-user quota supplements the existing in-process builder limiter across replicas.
CREATE TABLE builder_authorization.edit_quota (
 actor_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 window_start timestamptz NOT NULL DEFAULT clock_timestamp(), attempts integer NOT NULL DEFAULT 0
);
ALTER TABLE builder_authorization.edit_quota ENABLE ROW LEVEL SECURITY;
CREATE POLICY builder_edit_quota_owner ON builder_authorization.edit_quota FOR ALL TO authenticated USING(actor_user_id=auth.uid()) WITH CHECK(actor_user_id=auth.uid());
REVOKE ALL ON builder_authorization.edit_quota FROM PUBLIC,anon,authenticated,service_role,baci_builder_auth_storage;
GRANT SELECT,INSERT,UPDATE ON builder_authorization.edit_quota TO authenticated;

CREATE FUNCTION builder_authorization.operation_result(o builder_authorization.builder_edit_operations) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('storefrontId',o.merchant_id,'operationId',o.id,'sourceVersion','draft:'||o.source_version,'status',o.status,'summary',CASE o.status WHEN 'pending' THEN 'Draft edit queued.' WHEN 'running' THEN 'Preparing a draft candidate.' WHEN 'ready' THEN 'Draft candidate ready for review.' WHEN 'applied' THEN 'Draft candidate applied.' WHEN 'conflict' THEN 'The draft changed. Request a new edit.' ELSE 'The edit could not be completed.' END)
$$;
REVOKE ALL ON FUNCTION builder_authorization.operation_result(builder_authorization.builder_edit_operations) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION builder_authorization.operation_result(builder_authorization.builder_edit_operations) TO authenticated;
CREATE FUNCTION builder_authorization.lock_edit(p_connection uuid,p_version bigint,p_merchant uuid,p_operation uuid)
RETURNS builder_authorization.builder_edit_operations LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o builder_authorization.builder_edit_operations%ROWTYPE;
BEGIN
 PERFORM public.builder_lock_connection(p_connection,p_version,p_merchant);
 PERFORM public.builder_website_guard(p_merchant);
 SELECT * INTO o FROM builder_authorization.builder_edit_operations WHERE id=p_operation AND actor_user_id=auth.uid() AND connection_id=p_connection AND merchant_id=p_merchant AND grant_version=p_version FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF o.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'OPERATION_FAILED'; END IF;
 RETURN o;
END $$;
REVOKE ALL ON FUNCTION builder_authorization.lock_edit(uuid,bigint,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION builder_authorization.lock_edit(uuid,bigint,uuid,uuid) TO authenticated;

CREATE FUNCTION public.builder_queue_edit(p_connection uuid,p_version bigint,p_merchant uuid,p_expected uuid,p_retry_key uuid,p_instructions text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o builder_authorization.builder_edit_operations%ROWTYPE; rev uuid; config jsonb;
 digest text:=encode(sha256(convert_to(jsonb_build_object('merchant',p_merchant,'source',p_expected,'instructions',p_instructions)::text,'UTF8')),'hex');
BEGIN
 PERFORM public.builder_lock_connection(p_connection,p_version,p_merchant);
 PERFORM public.builder_website_guard(p_merchant);
 IF p_retry_key IS NULL OR length(btrim(p_instructions)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO o FROM builder_authorization.builder_edit_operations WHERE connection_id=p_connection AND actor_user_id=auth.uid() AND retry_key=p_retry_key;
 IF FOUND THEN
  IF o.input_digest<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  IF o.grant_version<>p_version OR o.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'OPERATION_FAILED'; END IF;
 ELSE
  SELECT token INTO rev FROM public.builder_website_revisions WHERE merchant_id=p_merchant;
  IF rev IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','error','code','STALE_DRAFT','currentVersion','draft:'||rev); END IF;
  SELECT d.draft_config INTO config FROM public.builder_page_drafts d JOIN public.page_configs p ON p.id=d.id JOIN public.merchants m ON m.id=d.merchant_id WHERE m.id=p_merchant AND m.user_id=auth.uid() AND m.template_id='puck' AND p.page_slug='home';
  IF config IS NULL OR coalesce(config#>>'{root,props,rendererVersion}','')<>'baci-home-six-v1' THEN RAISE EXCEPTION 'UNSUPPORTED_TEMPLATE'; END IF;
  IF (SELECT count(*) FROM builder_authorization.builder_edit_operations WHERE actor_user_id=auth.uid() AND status IN('pending','running','ready') AND expires_at>clock_timestamp())>=20 THEN RAISE EXCEPTION 'OPERATION_FAILED'; END IF;
  INSERT INTO builder_authorization.builder_edit_operations(merchant_id,connection_id,actor_user_id,grant_version,source_version,input,retry_key,input_digest,source_config)
   VALUES(p_merchant,p_connection,auth.uid(),p_version,p_expected,jsonb_build_object('instructions',p_instructions),p_retry_key,digest,config) RETURNING * INTO o;
 END IF;
 RETURN jsonb_build_object('storefrontId',o.merchant_id,'operationId',o.id,'sourceVersion','draft:'||o.source_version,'status','pending');
END $$;

CREATE FUNCTION public.builder_get_operation(p_connection uuid,p_version bigint,p_merchant uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c builder_authorization.connections%ROWTYPE; o builder_authorization.builder_edit_operations%ROWTYPE;
BEGIN
 PERFORM public.builder_require_private_storage();
 SELECT * INTO c FROM builder_authorization.connections WHERE id=p_connection AND actor_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR c.status<>'active' OR c.revoked_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR c.grant_version<>p_version THEN RAISE EXCEPTION 'CONNECTION_REVOKED'; END IF;
 IF NOT 'storefront.read'=ANY(c.scopes) THEN RAISE EXCEPTION 'INSUFFICIENT_SCOPE'; END IF;
 IF NOT p_merchant=ANY(c.allowed_merchant_ids) OR NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=p_merchant AND user_id=auth.uid()) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO o FROM builder_authorization.builder_edit_operations WHERE id=p_operation AND connection_id=p_connection AND merchant_id=p_merchant AND actor_user_id=auth.uid() AND grant_version=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF o.expires_at<=clock_timestamp() AND o.status<>'applied' THEN o.status:='failed'; END IF;
 RETURN builder_authorization.operation_result(o);
END $$;

CREATE FUNCTION public.builder_claim_edit(p_connection uuid,p_version bigint,p_merchant uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o builder_authorization.builder_edit_operations%ROWTYPE; q builder_authorization.edit_quota%ROWTYPE;
BEGIN
 o:=builder_authorization.lock_edit(p_connection,p_version,p_merchant,p_operation);
 IF o.status NOT IN('pending','running') OR (o.status='pending' AND o.next_attempt_at>clock_timestamp()) OR (o.status='running' AND o.lease_expires_at>clock_timestamp()) THEN RETURN NULL; END IF;
 IF o.attempts>=3 THEN UPDATE builder_authorization.builder_edit_operations SET status='failed',lease_id=NULL,lease_expires_at=NULL WHERE id=o.id;RETURN NULL; END IF;
 IF o.source_version IS DISTINCT FROM (SELECT token FROM public.builder_website_revisions WHERE merchant_id=p_merchant) THEN UPDATE builder_authorization.builder_edit_operations SET status='conflict',lease_id=NULL,lease_expires_at=NULL WHERE id=o.id;RETURN NULL; END IF;
 INSERT INTO builder_authorization.edit_quota(actor_user_id) VALUES(auth.uid()) ON CONFLICT DO NOTHING;
 SELECT * INTO q FROM builder_authorization.edit_quota WHERE actor_user_id=auth.uid() FOR UPDATE;
 IF q.window_start<=clock_timestamp()-interval '1 minute' THEN q.window_start:=clock_timestamp();q.attempts:=0;END IF;
 IF q.attempts>=10 THEN RETURN NULL;END IF;
 UPDATE builder_authorization.edit_quota SET window_start=q.window_start,attempts=q.attempts+1 WHERE actor_user_id=auth.uid();
 UPDATE builder_authorization.builder_edit_operations SET status='running',attempts=attempts+1,lease_id=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE id=o.id RETURNING * INTO o;
 RETURN jsonb_build_object('operationId',o.id,'connectionId',o.connection_id,'grantVersion',o.grant_version,'sourceVersion','draft:'||o.source_version,'leaseId',o.lease_id,'leaseExpiresAt',o.lease_expires_at,'attempt',o.attempts,'instructions',o.input->>'instructions','sourceConfig',o.source_config);
END $$;

CREATE FUNCTION builder_authorization.edit_candidate_digest(p_operation uuid,p_source uuid,p_candidate jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('operation',p_operation,'source',p_source,'candidate',p_candidate)::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION builder_authorization.edit_candidate_digest(uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION builder_authorization.edit_candidate_digest(uuid,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.builder_finish_edit(p_connection uuid,p_version bigint,p_merchant uuid,p_operation uuid,p_lease uuid,p_outcome text,p_candidate jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o builder_authorization.builder_edit_operations%ROWTYPE;
BEGIN
 o:=builder_authorization.lock_edit(p_connection,p_version,p_merchant,p_operation);
 IF o.status<>'running' OR o.lease_id IS DISTINCT FROM p_lease OR o.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'OPERATION_FAILED'; END IF;
 IF o.source_version IS DISTINCT FROM (SELECT token FROM public.builder_website_revisions WHERE merchant_id=p_merchant) THEN o.status:='conflict';
 ELSIF p_outcome='ready' THEN
  IF p_candidate IS NULL OR coalesce(p_candidate#>>'{root,props,rendererVersion}','')<>'baci-home-six-v1' OR jsonb_typeof(p_candidate->'content')<>'array' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  o.status:='ready';
 ELSIF p_outcome='transient' THEN o.status:=CASE WHEN o.attempts<3 THEN 'pending' ELSE 'failed' END;
 ELSIF p_outcome='failed' THEN o.status:='failed';
 ELSE RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 UPDATE builder_authorization.builder_edit_operations SET status=o.status,candidate=CASE WHEN o.status='ready' THEN p_candidate ELSE NULL END,candidate_digest=CASE WHEN o.status='ready' THEN builder_authorization.edit_candidate_digest(o.id,o.source_version,p_candidate) ELSE NULL END,lease_id=NULL,lease_expires_at=NULL,next_attempt_at=clock_timestamp()+CASE WHEN o.attempts=1 THEN interval '60 seconds' ELSE interval '120 seconds' END WHERE id=o.id RETURNING * INTO o;
 RETURN builder_authorization.operation_result(o);
END $$;

CREATE FUNCTION public.builder_apply_operation(p_connection uuid,p_version bigint,p_merchant uuid,p_operation uuid,p_expected uuid,p_retry_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o builder_authorization.builder_edit_operations%ROWTYPE; result jsonb;
 digest text:=encode(sha256(convert_to(jsonb_build_object('operation',p_operation,'expected',p_expected,'retry',p_retry_key)::text,'UTF8')),'hex');
BEGIN
 o:=builder_authorization.lock_edit(p_connection,p_version,p_merchant,p_operation);
 IF p_retry_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF EXISTS(SELECT 1 FROM builder_authorization.builder_edit_operations WHERE connection_id=p_connection AND actor_user_id=auth.uid() AND apply_retry_key=p_retry_key AND id<>p_operation) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 IF o.status='applied' THEN
  IF o.apply_digest<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  RETURN o.applied_result;
 END IF;
 IF o.status<>'ready' OR o.source_version IS DISTINCT FROM p_expected OR o.candidate_digest IS DISTINCT FROM builder_authorization.edit_candidate_digest(o.id,o.source_version,o.candidate) THEN RAISE EXCEPTION 'OPERATION_FAILED';END IF;
 result:=public.builder_commit_draft(p_connection,p_version,p_merchant,p_expected,p_retry_key,o.candidate);
 UPDATE builder_authorization.builder_edit_operations SET status=CASE WHEN result->>'code'='STALE_DRAFT' THEN 'conflict' ELSE 'applied' END,applied_result=result,apply_digest=digest,apply_retry_key=p_retry_key WHERE id=o.id;
 RETURN result;
END $$;
-- Poll/worker discovery never generates or applies work.
CREATE FUNCTION public.builder_list_due_edits(p_connection uuid,p_version bigint,p_merchant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.builder_lock_connection(p_connection,p_version,p_merchant);
 RETURN (SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM (SELECT id FROM builder_authorization.builder_edit_operations WHERE actor_user_id=auth.uid() AND connection_id=p_connection AND merchant_id=p_merchant AND grant_version=p_version AND expires_at>clock_timestamp() AND ((status='pending' AND next_attempt_at<=clock_timestamp()) OR (status='running' AND lease_expires_at<=clock_timestamp())) ORDER BY created_at LIMIT 20) due);
END $$;
REVOKE ALL ON FUNCTION public.builder_queue_edit(uuid,bigint,uuid,uuid,uuid,text),public.builder_get_operation(uuid,bigint,uuid,uuid),public.builder_claim_edit(uuid,bigint,uuid,uuid),public.builder_finish_edit(uuid,bigint,uuid,uuid,uuid,text,jsonb),public.builder_apply_operation(uuid,bigint,uuid,uuid,uuid,uuid),public.builder_list_due_edits(uuid,bigint,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_queue_edit(uuid,bigint,uuid,uuid,uuid,text),public.builder_get_operation(uuid,bigint,uuid,uuid),public.builder_claim_edit(uuid,bigint,uuid,uuid),public.builder_finish_edit(uuid,bigint,uuid,uuid,uuid,text,jsonb),public.builder_apply_operation(uuid,bigint,uuid,uuid,uuid,uuid),public.builder_list_due_edits(uuid,bigint,uuid) TO authenticated;
CREATE FUNCTION public.builder_load_edit_lease(p_connection uuid,p_version bigint,p_merchant uuid,p_operation uuid,p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o builder_authorization.builder_edit_operations%ROWTYPE;
BEGIN
 o:=builder_authorization.lock_edit(p_connection,p_version,p_merchant,p_operation);
 IF o.status<>'running' OR o.lease_id IS DISTINCT FROM p_lease OR o.lease_expires_at<=clock_timestamp() OR o.source_version IS DISTINCT FROM (SELECT token FROM public.builder_website_revisions WHERE merchant_id=p_merchant) THEN RAISE EXCEPTION 'OPERATION_FAILED'; END IF;
 RETURN jsonb_build_object('operationId',o.id,'connectionId',o.connection_id,'grantVersion',o.grant_version,'sourceVersion','draft:'||o.source_version,'leaseId',o.lease_id,'leaseExpiresAt',o.lease_expires_at,'attempt',o.attempts,'instructions',o.input->>'instructions','sourceConfig',o.source_config);
END $$;
CREATE FUNCTION public.builder_operation_context(p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o builder_authorization.builder_edit_operations%ROWTYPE;
BEGIN
 SELECT * INTO o FROM builder_authorization.builder_edit_operations WHERE id=p_operation AND actor_user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM public.builder_lock_connection(o.connection_id,o.grant_version,o.merchant_id);
 RETURN jsonb_build_object('connectionId',o.connection_id,'grantVersion',o.grant_version,'merchantId',o.merchant_id);
END $$;
REVOKE ALL ON FUNCTION public.builder_load_edit_lease(uuid,bigint,uuid,uuid,uuid),public.builder_operation_context(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_load_edit_lease(uuid,bigint,uuid,uuid,uuid),public.builder_operation_context(uuid) TO authenticated;

-- Include bounded pending operation IDs in the status projection, never private input/output.
CREATE OR REPLACE FUNCTION public.builder_read_storefronts(p_connection uuid,p_version bigint,p_merchant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c builder_authorization.connections%ROWTYPE; result jsonb;
BEGIN
 PERFORM public.builder_require_private_storage();
 SELECT * INTO c FROM builder_authorization.connections WHERE id=p_connection AND actor_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR c.status<>'active' OR c.revoked_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR c.grant_version<>p_version THEN RAISE EXCEPTION 'CONNECTION_REVOKED' USING ERRCODE='42501'; END IF;
 IF NOT 'storefront.read'=ANY(c.scopes) THEN RAISE EXCEPTION 'INSUFFICIENT_SCOPE' USING ERRCODE='42501'; END IF;
 IF p_merchant IS NOT NULL AND NOT p_merchant=ANY(c.allowed_merchant_ids) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'business_name',m.business_name,'slug',m.slug,'template_id',m.template_id,
 'draft_config',d.draft_config,'version',CASE WHEN r.token IS NULL THEN NULL ELSE 'draft:'||r.token END,'is_published',coalesce(p.is_published,false),'pendingOperationIds',(SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM (SELECT id FROM builder_authorization.builder_edit_operations WHERE merchant_id=m.id AND connection_id=p_connection AND grant_version=p_version AND status IN('pending','running','ready') AND expires_at>clock_timestamp() ORDER BY created_at LIMIT 20) pending))), '[]'::jsonb)
 INTO result FROM public.merchants m
 LEFT JOIN public.page_configs p ON p.merchant_id=m.id AND p.page_slug='home'
 LEFT JOIN public.builder_page_drafts d ON d.id=p.id AND d.merchant_id=m.id
 LEFT JOIN public.builder_website_revisions r ON r.merchant_id=m.id
 WHERE m.user_id=auth.uid() AND m.id=ANY(c.allowed_merchant_ids) AND (p_merchant IS NULL OR m.id=p_merchant);
 RETURN result;
END $$;

CREATE FUNCTION public.builder_prepare_apply(p_connection uuid,p_version bigint,p_merchant uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o builder_authorization.builder_edit_operations%ROWTYPE;
BEGIN
 o:=builder_authorization.lock_edit(p_connection,p_version,p_merchant,p_operation);
 IF o.status='applied' THEN RETURN NULL; END IF;
 IF o.status<>'ready' OR o.candidate_digest IS DISTINCT FROM builder_authorization.edit_candidate_digest(o.id,o.source_version,o.candidate) THEN RAISE EXCEPTION 'OPERATION_FAILED';END IF;
 RETURN jsonb_build_object('sourceConfig',o.source_config,'candidate',o.candidate,'candidateDigest',o.candidate_digest);
END $$;
REVOKE ALL ON FUNCTION public.builder_prepare_apply(uuid,bigint,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_prepare_apply(uuid,bigint,uuid,uuid) TO authenticated;
