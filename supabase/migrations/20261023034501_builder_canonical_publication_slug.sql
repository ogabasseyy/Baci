-- Existing canonical merchant slugs may contain one or two characters.
CREATE OR REPLACE FUNCTION public.builder_request_publication(p_connection uuid,p_version bigint,p_merchant uuid,p_expected text,p_retry_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i builder_authorization.publication_intents%ROWTYPE; r builder_authorization.publication_receipts%ROWTYPE; source uuid; cfg jsonb; destination text; digest text;
 input_hash text:=encode(sha256(convert_to(jsonb_build_object('merchant',p_merchant,'expected',p_expected,'namespace','baci.website-builder','policy',1)::text,'UTF8')),'hex');
BEGIN
 PERFORM builder_authorization.lock_publication(p_connection,p_version,p_merchant);
 SELECT * INTO i FROM builder_authorization.publication_intents WHERE actor_user_id=auth.uid() AND connection_id=p_connection AND retry_key=p_retry_key FOR UPDATE;
 IF FOUND THEN
  IF i.input_digest<>input_hash OR i.merchant_id<>p_merchant THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  SELECT * INTO r FROM builder_authorization.publication_receipts WHERE intent_id=i.id OR (merchant_id=i.merchant_id AND source_version=i.source_version AND effect_digest=i.effect_digest AND policy_namespace=i.policy_namespace AND policy_version=i.policy_version);
  IF FOUND AND r.connection_id<>p_connection THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF FOUND THEN RETURN builder_authorization.publication_result(r.id);END IF;
  IF i.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'APPROVAL_ALREADY_USED';END IF;
  IF i.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'APPROVAL_EXPIRED';END IF;
  RETURN jsonb_build_object('storefrontId',p_merchant,'version','draft:'||i.source_version,'status','approval_required','intentId',i.id,'approvalUrl','https://usebaci.com/builder/approve?intent='||i.id);
 END IF;
 SELECT token INTO source FROM public.builder_website_revisions WHERE merchant_id=p_merchant;
 IF source IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p_expected IS DISTINCT FROM 'draft:'||source THEN RETURN jsonb_build_object('status','error','code','STALE_DRAFT','error','The draft changed. Read the current revision and try again.','currentVersion','draft:'||source);END IF;
 SELECT d.draft_config INTO cfg FROM public.page_configs p JOIN public.builder_page_drafts d ON d.id=p.id WHERE p.merchant_id=p_merchant AND p.page_slug='home';
 IF (SELECT template_id FROM public.merchants WHERE id=p_merchant) IS DISTINCT FROM 'puck' OR cfg#>>'{root,props,rendererVersion}' IS DISTINCT FROM 'baci-home-six-v1' THEN RAISE EXCEPTION 'UNSUPPORTED_TEMPLATE';END IF;
 SELECT 'https://'||m.slug||'.'||c.root_domain INTO destination FROM public.merchants m CROSS JOIN builder_authorization.website_configuration c WHERE m.id=p_merchant AND c.singleton AND m.slug~'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' AND c.root_domain='usebaci.com';
 IF destination IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 digest:=builder_authorization.publication_digest(cfg,source,destination);
 SELECT * INTO r FROM builder_authorization.publication_receipts WHERE merchant_id=p_merchant AND source_version=source AND effect_digest=digest AND policy_namespace='baci.website-builder' AND policy_version=1;
 IF FOUND THEN
  IF r.connection_id<>p_connection THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  RETURN builder_authorization.publication_result(r.id);
 END IF;
 INSERT INTO builder_authorization.publication_intents(actor_user_id,connection_id,grant_version,merchant_id,source_version,retry_key,config,destination_url,effect_digest,input_digest) VALUES(auth.uid(),p_connection,p_version,p_merchant,source,p_retry_key,cfg,destination,digest,input_hash) RETURNING * INTO i;
 RETURN jsonb_build_object('storefrontId',p_merchant,'version','draft:'||source,'status','approval_required','intentId',i.id,'approvalUrl','https://usebaci.com/builder/approve?intent='||i.id);
END $$;
