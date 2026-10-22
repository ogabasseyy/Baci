CREATE FUNCTION builder_authorization.publication_digest(p_config jsonb,p_source uuid,p_destination text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$ SELECT encode(sha256(convert_to(jsonb_build_object('config',p_config,'source',p_source,'destination',p_destination,'pages',jsonb_build_array('home'),'namespace','baci.website-builder','policy',1)::text,'UTF8')),'hex') $$;
CREATE FUNCTION builder_authorization.lock_publication(p_connection uuid,p_version bigint,p_merchant uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c builder_authorization.connections%ROWTYPE;
BEGIN
 PERFORM public.builder_require_private_storage();
 SELECT * INTO c FROM builder_authorization.connections WHERE id=p_connection AND actor_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR c.status<>'active' OR c.revoked_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR c.grant_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'CONNECTION_REVOKED' USING ERRCODE='42501';END IF;
 IF NOT ('storefront.read'=ANY(c.scopes) AND 'storefront.publish'=ANY(c.scopes)) THEN RAISE EXCEPTION 'INSUFFICIENT_SCOPE' USING ERRCODE='42501';END IF;
 IF NOT p_merchant=ANY(c.allowed_merchant_ids) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='42501';END IF;
 PERFORM public.builder_website_guard(p_merchant);
 PERFORM id FROM public.merchants WHERE id=p_merchant AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION builder_authorization.publication_result(p_receipt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r builder_authorization.publication_receipts%ROWTYPE; current_version uuid; visible boolean; base jsonb;
BEGIN
 SELECT * INTO r FROM builder_authorization.publication_receipts WHERE id=p_receipt AND actor_user_id=auth.uid();IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT v.token,coalesce(m.is_published AND p.is_published,false) INTO current_version,visible FROM public.merchants m LEFT JOIN public.page_configs p ON p.merchant_id=m.id AND p.page_slug='home' LEFT JOIN public.builder_published_revisions v ON v.merchant_id=m.id WHERE m.id=r.merchant_id AND m.user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 base:=jsonb_build_object('storefrontId',r.merchant_id,'version','draft:'||r.source_version,'receiptId',r.id,'publishedVersion','published:'||r.published_version);
 IF NOT coalesce(visible,false) OR current_version IS DISTINCT FROM r.published_version THEN RETURN base||jsonb_build_object('status','superseded','currentPublishedVersion',CASE WHEN visible THEN 'published:'||current_version ELSE NULL END);END IF;
 IF r.verified_at IS NULL THEN RETURN base||jsonb_build_object('status','verifying');END IF;
 RETURN base||jsonb_build_object('status','live','publicUrl',r.destination_url,'verifiedAt',to_char(r.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END $$;
CREATE FUNCTION public.builder_request_publication(p_connection uuid,p_version bigint,p_merchant uuid,p_expected text,p_retry_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
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
 SELECT 'https://'||m.slug||'.'||c.root_domain INTO destination FROM public.merchants m CROSS JOIN builder_authorization.website_configuration c WHERE m.id=p_merchant AND c.singleton AND m.slug~'^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' AND c.root_domain='usebaci.com';
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
CREATE FUNCTION public.builder_load_publication_intent(p_intent uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i builder_authorization.publication_intents%ROWTYPE; c builder_authorization.connections%ROWTYPE;r uuid;
BEGIN
 SELECT * INTO i FROM builder_authorization.publication_intents WHERE id=p_intent AND actor_user_id=auth.uid();IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT id INTO r FROM builder_authorization.publication_receipts WHERE intent_id=i.id;
 IF r IS NOT NULL THEN RETURN jsonb_build_object('receipt',builder_authorization.publication_result(r));END IF;
 PERFORM builder_authorization.lock_publication(i.connection_id,i.grant_version,i.merchant_id);
 SELECT * INTO c FROM builder_authorization.connections WHERE id=i.connection_id;
 RETURN jsonb_build_object('intent',jsonb_build_object('intentId',i.id,'actorUserId',i.actor_user_id,'connectionId',i.connection_id,'grantVersion',i.grant_version,'storefrontId',i.merchant_id,'draftVersion','draft:'||i.source_version,'destinationUrl',i.destination_url,'pageSlugs',jsonb_build_array('home'),'policyNamespace',i.policy_namespace,'policyVersion',i.policy_version,'effectDigest',i.effect_digest,'nonce',i.nonce::text,'issuedAt',i.issued_at,'expiresAt',i.expires_at),'config',i.config,'identity',jsonb_build_object('actorUserId',i.actor_user_id,'connectionId',i.connection_id,'grantVersion',c.grant_version,'allowedMerchantIds',c.allowed_merchant_ids,'allowCreateStore',c.allow_create_store,'scopes',c.scopes),'currentVersion',(SELECT 'draft:'||token FROM public.builder_website_revisions WHERE merchant_id=i.merchant_id));
END $$;
REVOKE ALL ON FUNCTION builder_authorization.publication_digest(jsonb,uuid,text),builder_authorization.lock_publication(uuid,bigint,uuid),builder_authorization.publication_result(uuid),public.builder_request_publication(uuid,bigint,uuid,text,uuid),public.builder_load_publication_intent(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION builder_authorization.publication_digest(jsonb,uuid,text),builder_authorization.lock_publication(uuid,bigint,uuid),builder_authorization.publication_result(uuid),public.builder_request_publication(uuid,bigint,uuid,text,uuid),public.builder_load_publication_intent(uuid) TO authenticated;
