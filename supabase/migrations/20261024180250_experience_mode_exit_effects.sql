CREATE TABLE experience_authorization.legacy_ai_holds(
 merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id),intent_id uuid NOT NULL REFERENCES experience_authorization.lifecycle_intents(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX experience_legacy_ai_hold_intent ON experience_authorization.legacy_ai_holds(intent_id);
ALTER TABLE experience_authorization.legacy_ai_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.legacy_ai_holds FROM PUBLIC,anon,authenticated,service_role;
-- Explicit exit is not permission to resume chargeable inference automatically.
CREATE OR REPLACE FUNCTION public.experience_begin_legacy_execution(p_merchant uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE lease uuid;
BEGIN
 PERFORM public.experience_require_legacy(p_merchant);
 IF EXISTS(SELECT 1 FROM experience_authorization.legacy_ai_holds WHERE merchant_id=p_merchant) THEN RAISE EXCEPTION 'LEGACY_AI_RESUME_REQUIRED';END IF;
 IF (SELECT count(*) FROM experience_authorization.legacy_execution_leases WHERE merchant_id=p_merchant AND completed_at IS NULL)>=4 THEN RAISE EXCEPTION 'EXECUTION_BUSY';END IF;
 INSERT INTO experience_authorization.legacy_execution_leases(merchant_id,actor_user_id) VALUES(p_merchant,auth.uid()) RETURNING id INTO lease;RETURN lease;
END $$;
CREATE FUNCTION public.experience_confirm_mode_exit(p_intent uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i experience_authorization.lifecycle_intents;r experience_authorization.lifecycle_receipts;loaded jsonb;revision bigint;token uuid;
BEGIN
 SELECT * INTO i FROM experience_authorization.lifecycle_intents WHERE id=p_intent AND actor_user_id=auth.uid() AND action IN('draft-only','restore-legacy','unpublish-legacy-draft');
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM experience_authorization.require_lifecycle_owner(i.merchant_id,i.connection_id,i.grant_version,i.action<>'draft-only');
 SELECT * INTO r FROM experience_authorization.lifecycle_receipts WHERE intent_id=i.id;
 IF FOUND THEN RETURN experience_authorization.lifecycle_result(r.id);END IF;
 loaded:=public.experience_load_lifecycle(p_intent);
 IF NOT EXISTS(SELECT 1 FROM experience_authorization.lifecycle_checks c WHERE c.intent_id=i.id AND c.kind='render' AND c.effect_digest=i.effect_digest AND c.verified_at>=i.issued_at AND c.verified_at<=clock_timestamp() AND c.expires_at>clock_timestamp() AND c.expires_at<=i.expires_at) THEN RAISE EXCEPTION 'PREVIEW_REQUIRED';END IF;
 PERFORM experience_authorization.require_idle_legacy(i.merchant_id);
 DELETE FROM public.experience_draft_heads WHERE merchant_id=i.merchant_id;
 IF i.action<>'draft-only' THEN
  DELETE FROM public.experience_published_heads WHERE merchant_id=i.merchant_id;
  IF i.action='restore-legacy' THEN UPDATE public.merchants SET is_published=true WHERE id=i.merchant_id;
  ELSE UPDATE public.merchants SET is_published=false WHERE id=i.merchant_id;END IF;
  INSERT INTO public.builder_published_revisions(merchant_id) VALUES(i.merchant_id) ON CONFLICT(merchant_id) DO UPDATE SET last_txid=txid_current() RETURNING builder_published_revisions.token INTO token;
 END IF;
 INSERT INTO experience_authorization.legacy_ai_holds(merchant_id,intent_id) VALUES(i.merchant_id,i.id) ON CONFLICT(merchant_id) DO UPDATE SET intent_id=EXCLUDED.intent_id,created_at=clock_timestamp();
 INSERT INTO public.builder_website_revisions(merchant_id) VALUES(i.merchant_id) ON CONFLICT(merchant_id) DO UPDATE SET last_txid=txid_current();
 SELECT coalesce(max(publication_revision),0)+1 INTO revision FROM experience_authorization.lifecycle_receipts WHERE merchant_id=i.merchant_id;
 INSERT INTO experience_authorization.lifecycle_receipts(intent_id,merchant_id,publication_revision,published_token,action) VALUES(i.id,i.merchant_id,revision,token,i.action) RETURNING * INTO r;
 RETURN experience_authorization.lifecycle_result(r.id);
END $$;
REVOKE ALL ON FUNCTION public.experience_confirm_mode_exit(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_confirm_mode_exit(uuid) TO authenticated;
-- Metadata exposes whether explicit AI resumption is still required, never source.
CREATE FUNCTION public.experience_legacy_ai_held(p_merchant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.check_staff_permission(auth.uid(),p_merchant,'builder','view') THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 RETURN EXISTS(SELECT 1 FROM experience_authorization.legacy_ai_holds WHERE merchant_id=p_merchant);
END $$;
REVOKE ALL ON FUNCTION public.experience_legacy_ai_held(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_legacy_ai_held(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.experience_load_draft_approval(p_intent uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i experience_authorization.apply_intents; current_effect text; r experience_authorization.apply_receipts;
BEGIN
 SELECT * INTO i FROM experience_authorization.apply_intents WHERE id=p_intent AND actor_user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM public.experience_require_owner(i.merchant_id,i.connection_id,i.grant_version);
 PERFORM public.builder_website_guard(i.merchant_id);
 SELECT * INTO r FROM experience_authorization.apply_receipts WHERE intent_id=i.id;
 IF FOUND THEN RETURN jsonb_build_object('status','applied','approvalId',i.id,'merchantId',i.merchant_id,'buildId',r.build_id,'version',r.version);END IF;
 IF i.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'APPROVAL_EXPIRED';END IF;
 current_effect:=experience_authorization.apply_effect(i.merchant_id,i.build_id,i.evidence_id,i.expected_version);
 IF current_effect<>i.effect_digest THEN RAISE EXCEPTION 'APPROVAL_MISMATCH';END IF;
 RETURN jsonb_build_object('approvalId',i.id,'merchantId',i.merchant_id,'buildId',i.build_id,'evidenceId',i.evidence_id,'effectDigest',i.effect_digest,'expectedVersion',i.expected_version,'expiresAt',i.expires_at,'status','confirmation-required');
END $$;
