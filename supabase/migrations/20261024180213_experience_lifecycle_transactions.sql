CREATE FUNCTION experience_authorization.require_lifecycle_owner(p_merchant uuid,p_connection uuid,p_version bigint,p_publish boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_publish THEN PERFORM public.experience_authorize_read(p_merchant,p_connection,p_version);
 ELSE PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);END IF;
 IF p_publish AND p_connection IS NOT NULL AND NOT EXISTS(SELECT 1 FROM builder_authorization.connections WHERE id=p_connection AND grant_version=p_version AND 'storefront.publish'=ANY(scopes)) THEN RAISE EXCEPTION 'INSUFFICIENT_SCOPE';END IF;
 PERFORM public.builder_website_guard(p_merchant);
 PERFORM 1 FROM public.merchants WHERE id=p_merchant FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION experience_authorization.require_lifecycle_owner(uuid,uuid,bigint,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION experience_authorization.lifecycle_result(p_receipt uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r experience_authorization.lifecycle_receipts; i experience_authorization.lifecycle_intents; active boolean; live boolean;
BEGIN
 SELECT * INTO r FROM experience_authorization.lifecycle_receipts WHERE id=p_receipt;
 SELECT * INTO i FROM experience_authorization.lifecycle_intents WHERE id=r.intent_id AND actor_user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM experience_authorization.require_lifecycle_owner(i.merchant_id,i.connection_id,i.grant_version,i.action<>'draft-only');
 IF r.action NOT IN('publish','rollback') THEN RETURN jsonb_build_object('approvalId',i.id,'effectDigest',i.effect_digest,'merchantId',i.merchant_id,'receiptId',r.id,'status','applied','action',r.action,'publishedVersion',r.publication_revision);END IF;
 active:=EXISTS(SELECT 1 FROM public.experience_published_heads h JOIN public.merchants m ON m.id=h.merchant_id JOIN public.builder_published_revisions v ON v.merchant_id=m.id WHERE h.merchant_id=r.merchant_id AND h.build_id=r.build_id AND h.publication_revision=r.publication_revision AND m.is_published AND v.token=r.published_token);
 live:=EXISTS(SELECT 1 FROM experience_authorization.lifecycle_checks c WHERE c.receipt_id=r.id AND c.intent_id=i.id AND c.kind='public' AND c.effect_digest=i.effect_digest AND c.verified_at>=r.committed_at AND c.verified_at<=clock_timestamp());
 RETURN jsonb_build_object('approvalId',i.id,'effectDigest',i.effect_digest,'merchantId',i.merchant_id,'receiptId',r.id,'status',CASE WHEN NOT active THEN 'superseded' WHEN live THEN 'live' ELSE 'verifying' END,'action',r.action,'buildId',r.build_id,'publishedVersion',r.publication_revision);
END $$;
REVOKE ALL ON FUNCTION experience_authorization.lifecycle_result(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.experience_request_lifecycle(p_merchant uuid,p_connection uuid,p_version bigint,p_action text,p_payload jsonb,p_retry uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i experience_authorization.lifecycle_intents; r uuid; snap jsonb; effect text; missing jsonb;
BEGIN
 PERFORM experience_authorization.require_lifecycle_owner(p_merchant,p_connection,p_version,p_action<>'draft-only');
 IF p_retry IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>4096 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('buildId','expectedDraftVersion','expectedPublishedVersion','targetLegacyRevision')) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 SELECT * INTO i FROM experience_authorization.lifecycle_intents WHERE merchant_id=p_merchant AND actor_user_id=auth.uid() AND connection_id IS NOT DISTINCT FROM p_connection AND retry_key=p_retry;
 IF FOUND THEN
  IF i.action IS DISTINCT FROM p_action OR i.payload IS DISTINCT FROM p_payload OR i.grant_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  SELECT id INTO r FROM experience_authorization.lifecycle_receipts WHERE intent_id=i.id;
  IF FOUND THEN RETURN experience_authorization.lifecycle_result(r);END IF;
 ELSE
  snap:=experience_authorization.lifecycle_snapshot(p_merchant,p_action,p_payload);
  IF p_action IN('publish','rollback') THEN
   missing:=snap->'readiness';
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(snap#>'{manifest,capabilities}') c WHERE c IN('cart.read-public','cart.mutate','checkout.prepare','checkout.open')) AND NOT (coalesce(snap->'enrolled','[]'::jsonb) @> '["shared_cart"]'::jsonb) THEN missing:=missing||jsonb_build_array('shared_cart enrollment');END IF;
   IF jsonb_array_length(missing)>0 THEN RETURN jsonb_build_object('status','blocked','missingItems',missing);END IF;
  END IF;
  IF (SELECT count(*) FROM experience_authorization.lifecycle_intents WHERE merchant_id=p_merchant AND expires_at>clock_timestamp())>=32 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED';END IF;
  effect:=encode(sha256(convert_to(snap::text,'UTF8')),'hex');
  INSERT INTO experience_authorization.lifecycle_intents(merchant_id,actor_user_id,connection_id,grant_version,retry_key,action,payload,effect_digest,snapshot)
   VALUES(p_merchant,auth.uid(),p_connection,p_version,p_retry,p_action,p_payload,effect,snap) RETURNING * INTO i;
 END IF;
 RETURN jsonb_build_object('approvalId',i.id,'effectDigest',i.effect_digest,'expiresAt',i.expires_at,'status','confirmation-required','action',i.action);
END $$;
CREATE FUNCTION public.experience_load_lifecycle(p_intent uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i experience_authorization.lifecycle_intents; r uuid; snap jsonb;
BEGIN
 SELECT * INTO i FROM experience_authorization.lifecycle_intents WHERE id=p_intent AND actor_user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM experience_authorization.require_lifecycle_owner(i.merchant_id,i.connection_id,i.grant_version,i.action<>'draft-only');
 SELECT id INTO r FROM experience_authorization.lifecycle_receipts WHERE intent_id=i.id;
 IF FOUND THEN RETURN experience_authorization.lifecycle_result(r);END IF;
 IF i.expires_at<=clock_timestamp() OR i.issued_at>clock_timestamp() THEN RAISE EXCEPTION 'APPROVAL_EXPIRED';END IF;
 snap:=experience_authorization.lifecycle_snapshot(i.merchant_id,i.action,i.payload);
 IF snap IS DISTINCT FROM i.snapshot OR encode(sha256(convert_to(snap::text,'UTF8')),'hex')<>i.effect_digest THEN RAISE EXCEPTION 'APPROVAL_MISMATCH';END IF;
 RETURN jsonb_build_object('approvalId',i.id,'merchantId',i.merchant_id,'action',i.action,'effectDigest',i.effect_digest,'expiresAt',i.expires_at,'status','confirmation-required','summary',snap-'enrolled'-'sourceHead','buildId',snap->'build','routes',snap#>'{manifest,routes}','capabilities',snap#>'{manifest,capabilities}');
END $$;
CREATE FUNCTION public.experience_confirm_publication(p_intent uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i experience_authorization.lifecycle_intents; r experience_authorization.lifecycle_receipts; aid uuid; revision bigint; token uuid; loaded jsonb;
BEGIN
 SELECT * INTO i FROM experience_authorization.lifecycle_intents WHERE id=p_intent AND actor_user_id=auth.uid() AND action IN('publish','rollback');
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM experience_authorization.require_lifecycle_owner(i.merchant_id,i.connection_id,i.grant_version,true);
 SELECT * INTO r FROM experience_authorization.lifecycle_receipts WHERE intent_id=i.id;
 IF FOUND THEN RETURN experience_authorization.lifecycle_result(r.id);END IF;
 loaded:=public.experience_load_lifecycle(p_intent);
 IF NOT EXISTS(SELECT 1 FROM experience_authorization.lifecycle_checks c WHERE c.intent_id=i.id AND c.kind='render' AND c.effect_digest=i.effect_digest AND c.verified_at>=i.issued_at AND c.verified_at<=clock_timestamp() AND c.expires_at>clock_timestamp() AND c.expires_at<=i.expires_at) THEN RAISE EXCEPTION 'PREVIEW_REQUIRED';END IF;
 PERFORM experience_authorization.require_idle_legacy(i.merchant_id);
 INSERT INTO public.experience_approvals(merchant_id,build_id,effect_digest) VALUES(i.merchant_id,(i.payload->>'buildId')::uuid,i.effect_digest) RETURNING id INTO aid;
 SELECT coalesce(max(publication_revision),0)+1 INTO revision FROM experience_authorization.lifecycle_receipts WHERE merchant_id=i.merchant_id;
 INSERT INTO public.experience_published_heads(merchant_id,build_id,approval_id,publication_revision) VALUES(i.merchant_id,(i.payload->>'buildId')::uuid,aid,revision)
 ON CONFLICT(merchant_id) DO UPDATE SET build_id=EXCLUDED.build_id,approval_id=EXCLUDED.approval_id,publication_revision=EXCLUDED.publication_revision;
 UPDATE public.merchants SET is_published=true WHERE id=i.merchant_id AND is_published IS DISTINCT FROM true;
 INSERT INTO public.builder_published_revisions(merchant_id) VALUES(i.merchant_id) ON CONFLICT(merchant_id) DO UPDATE SET last_txid=txid_current() RETURNING builder_published_revisions.token INTO token;
 INSERT INTO public.builder_website_revisions(merchant_id) VALUES(i.merchant_id) ON CONFLICT(merchant_id) DO UPDATE SET last_txid=txid_current();
 INSERT INTO experience_authorization.lifecycle_receipts(intent_id,merchant_id,build_id,publication_revision,published_token,action) VALUES(i.id,i.merchant_id,(i.payload->>'buildId')::uuid,revision,token,i.action) RETURNING * INTO r;
 RETURN experience_authorization.lifecycle_result(r.id);
END $$;
REVOKE ALL ON FUNCTION public.experience_request_lifecycle(uuid,uuid,bigint,text,jsonb,uuid),public.experience_load_lifecycle(uuid),public.experience_confirm_publication(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_request_lifecycle(uuid,uuid,bigint,text,jsonb,uuid),public.experience_load_lifecycle(uuid),public.experience_confirm_publication(uuid) TO authenticated;
