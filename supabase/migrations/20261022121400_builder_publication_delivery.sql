CREATE FUNCTION public.builder_get_publication_receipt(p_receipt uuid,p_connection uuid DEFAULT NULL,p_version bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r builder_authorization.publication_receipts%ROWTYPE;
BEGIN
 SELECT * INTO r FROM builder_authorization.publication_receipts WHERE id=p_receipt AND actor_user_id=auth.uid();IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p_connection IS NOT NULL THEN
  PERFORM public.builder_read_storefronts(p_connection,p_version,r.merchant_id);
  IF r.connection_id<>p_connection THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 END IF;
 RETURN builder_authorization.publication_result(r.id);
END $$;
CREATE FUNCTION public.builder_claim_publication_delivery(p_receipt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r builder_authorization.publication_receipts%ROWTYPE;o builder_authorization.publication_outbox%ROWTYPE;result jsonb;lease uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO r FROM builder_authorization.publication_receipts WHERE id=p_receipt AND actor_user_id=auth.uid();IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=r.merchant_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 result:=builder_authorization.publication_result(r.id);
 IF result->>'status'<>'verifying' THEN RETURN jsonb_build_object('result',result);END IF;
 SELECT * INTO o FROM builder_authorization.publication_outbox WHERE receipt_id=r.id FOR UPDATE;
 IF NOT FOUND OR o.completed_at IS NOT NULL OR o.attempts>=20 OR o.next_attempt_at>clock_timestamp() OR o.lease_expires_at>clock_timestamp() THEN RETURN jsonb_build_object('result',result);END IF;
 UPDATE builder_authorization.publication_outbox SET lease_id=lease,lease_expires_at=clock_timestamp()+interval '90 seconds',attempts=attempts+1 WHERE receipt_id=r.id;
 RETURN jsonb_build_object('result',result,'leaseId',lease,'destinationUrl',r.destination_url,'intentId',r.intent_id,'effectDigest',r.effect_digest,'config',(SELECT config FROM builder_authorization.publication_intents WHERE id=r.intent_id));
END $$;
CREATE FUNCTION public.builder_finish_publication_delivery(p_receipt uuid,p_lease uuid,p_check uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r builder_authorization.publication_receipts%ROWTYPE;o builder_authorization.publication_outbox%ROWTYPE;result jsonb;
BEGIN
 SELECT * INTO r FROM builder_authorization.publication_receipts WHERE id=p_receipt AND actor_user_id=auth.uid();IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM public.builder_website_guard(r.merchant_id);
 PERFORM id FROM public.merchants WHERE id=r.merchant_id AND user_id=auth.uid() FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT * INTO o FROM builder_authorization.publication_outbox WHERE receipt_id=r.id FOR UPDATE;
 IF NOT FOUND OR o.lease_id IS DISTINCT FROM p_lease OR o.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'OPERATION_FAILED';END IF;
 result:=builder_authorization.publication_result(r.id);
 IF result->>'status'='superseded' THEN UPDATE builder_authorization.publication_outbox SET completed_at=clock_timestamp(),lease_id=NULL,lease_expires_at=NULL,last_error_code='SUPERSEDED' WHERE receipt_id=r.id;RETURN result;END IF;
 IF NOT EXISTS(SELECT 1 FROM builder_authorization.publication_checks x WHERE x.id=p_check AND x.receipt_id=r.id AND x.intent_id=r.intent_id AND x.kind='delivery' AND x.version='published:'||r.published_version AND x.effect_digest=r.effect_digest AND x.verified_at<=clock_timestamp() AND x.expires_at>clock_timestamp()) THEN
  UPDATE builder_authorization.publication_outbox SET lease_id=NULL,lease_expires_at=NULL,next_attempt_at=clock_timestamp()+interval '1 minute',last_error_code='DELIVERY_FAILED' WHERE receipt_id=r.id;RETURN result;
 END IF;
 UPDATE builder_authorization.publication_receipts SET verified_at=clock_timestamp() WHERE id=r.id AND verified_at IS NULL;
 UPDATE builder_authorization.publication_outbox SET completed_at=clock_timestamp(),lease_id=NULL,lease_expires_at=NULL,last_error_code=NULL WHERE receipt_id=r.id;
 RETURN builder_authorization.publication_result(r.id);
END $$;
CREATE FUNCTION public.builder_due_publications() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(receipt_id),'[]'::jsonb) FROM (SELECT o.receipt_id FROM builder_authorization.publication_outbox o JOIN public.merchants m ON m.id=o.merchant_id WHERE o.actor_user_id=auth.uid() AND m.user_id=auth.uid() AND o.completed_at IS NULL AND o.next_attempt_at<=clock_timestamp() AND coalesce(o.lease_expires_at,'-infinity')<=clock_timestamp() AND o.attempts<20 ORDER BY next_attempt_at LIMIT 20) due
$$;
REVOKE ALL ON FUNCTION public.builder_get_publication_receipt(uuid,uuid,bigint),public.builder_claim_publication_delivery(uuid),public.builder_finish_publication_delivery(uuid,uuid,uuid),public.builder_due_publications() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_get_publication_receipt(uuid,uuid,bigint),public.builder_claim_publication_delivery(uuid),public.builder_finish_publication_delivery(uuid,uuid,uuid),public.builder_due_publications() TO authenticated;
