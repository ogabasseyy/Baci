-- Independent verifier only: bind proof insertion atomically to the active head.
DROP POLICY independent_lifecycle_proof ON experience_authorization.lifecycle_checks;
CREATE POLICY independent_lifecycle_proof ON experience_authorization.lifecycle_checks
 FOR INSERT TO baci_experience_verifier WITH CHECK(kind='render' AND receipt_id IS NULL);
CREATE FUNCTION public.experience_record_public_check(p_receipt uuid, p_effect text, p_marker text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_intent uuid;
BEGIN
 IF p_receipt IS NULL OR coalesce(p_effect,'') !~ '^[a-f0-9]{64}$' OR coalesce(p_marker,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_PUBLIC_PROOF'; END IF;
 SELECT i.id INTO target_intent
 FROM experience_authorization.lifecycle_receipts r
 JOIN experience_authorization.lifecycle_intents i ON i.id=r.intent_id AND i.merchant_id=r.merchant_id AND i.effect_digest=p_effect AND i.action=r.action
 JOIN public.experience_published_heads h ON h.merchant_id=r.merchant_id AND h.build_id=r.build_id AND h.publication_revision=r.publication_revision
 JOIN public.merchants m ON m.id=r.merchant_id AND m.is_published IS TRUE
 JOIN public.builder_published_revisions v ON v.merchant_id=r.merchant_id AND v.token=r.published_token
 WHERE r.id=p_receipt AND r.action IN ('publish','rollback') AND r.committed_at<=statement_timestamp()
 FOR SHARE OF h,m,v;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_SUPERSEDED'; END IF;
 INSERT INTO experience_authorization.lifecycle_checks(intent_id,receipt_id,kind,effect_digest,marker_digest)
 VALUES(target_intent,p_receipt,'public',p_effect,p_marker);
END $$;
REVOKE ALL ON FUNCTION public.experience_record_public_check(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.experience_record_public_check(uuid,text,text) TO baci_experience_verifier;
