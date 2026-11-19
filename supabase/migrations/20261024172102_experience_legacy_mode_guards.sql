-- Checkpoint D: serialize mode entry and all legacy writers/provider admissions.
-- Native leases never expire into an implicit cancellation acknowledgement.
CREATE TABLE experience_authorization.legacy_execution_leases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz
);
CREATE INDEX experience_legacy_lease_merchant ON experience_authorization.legacy_execution_leases(merchant_id) WHERE completed_at IS NULL;
CREATE INDEX experience_legacy_lease_actor ON experience_authorization.legacy_execution_leases(actor_user_id);
ALTER TABLE experience_authorization.legacy_execution_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.legacy_execution_leases FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.experience_require_legacy(p_merchant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.check_staff_permission(auth.uid(),p_merchant,'builder','edit') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM public.builder_website_guard(p_merchant);
 IF EXISTS(SELECT 1 FROM public.experience_draft_heads WHERE merchant_id=p_merchant)
 OR EXISTS(SELECT 1 FROM public.experience_published_heads WHERE merchant_id=p_merchant) THEN RAISE EXCEPTION 'FULL_CODE_ACTIVE';END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.experience_require_legacy(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_require_legacy(uuid) TO authenticated;
CREATE FUNCTION public.experience_begin_legacy_execution(p_merchant uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE lease uuid;
BEGIN
 PERFORM public.experience_require_legacy(p_merchant);
 IF (SELECT count(*) FROM experience_authorization.legacy_execution_leases WHERE merchant_id=p_merchant AND completed_at IS NULL)>=4 THEN RAISE EXCEPTION 'EXECUTION_BUSY';END IF;
 INSERT INTO experience_authorization.legacy_execution_leases(merchant_id,actor_user_id) VALUES(p_merchant,auth.uid()) RETURNING id INTO lease;
 RETURN lease;
END $$;
CREATE FUNCTION public.experience_complete_legacy_execution(p_merchant uuid,p_lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM public.builder_website_guard(p_merchant);
 UPDATE experience_authorization.legacy_execution_leases SET completed_at=coalesce(completed_at,clock_timestamp())
 WHERE id=p_lease AND merchant_id=p_merchant AND actor_user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.experience_begin_legacy_execution(uuid),public.experience_complete_legacy_execution(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_begin_legacy_execution(uuid),public.experience_complete_legacy_execution(uuid,uuid) TO authenticated;
CREATE FUNCTION experience_authorization.require_idle_legacy(p_merchant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.experience_require_owner(p_merchant);
 PERFORM public.builder_website_guard(p_merchant);
 IF EXISTS(SELECT 1 FROM experience_authorization.legacy_execution_leases WHERE merchant_id=p_merchant AND completed_at IS NULL)
 OR EXISTS(SELECT 1 FROM builder_authorization.builder_edit_operations WHERE merchant_id=p_merchant AND status='running')
 THEN RAISE EXCEPTION 'LEGACY_EXECUTION_ACTIVE'; END IF;
END $$;
REVOKE ALL ON FUNCTION experience_authorization.require_idle_legacy(uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Insert a guard before existing authorization/business operations; old function
-- bodies and signatures remain intact. Assert the exact known function set.
DO $$
DECLARE name text; arg text; target regprocedure; definition text; at_begin integer; args text[];
BEGIN
 FOR name,arg IN SELECT * FROM (VALUES
 ('builder_private_save','p_merchant_id'),('builder_private_publish','p_merchant_id'),
 ('builder_queue_edit','p_merchant'),('builder_claim_edit','p_merchant'),('builder_finish_edit','p_merchant'),
 ('builder_prepare_apply','p_merchant'),('builder_apply_operation','p_merchant'),('builder_load_edit_lease','p_merchant')) x(name,arg)
 LOOP
  SELECT p.oid::regprocedure INTO STRICT target FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name;
  definition:=pg_get_functiondef(target); at_begin:=strpos(definition,'BEGIN');
  SELECT proargnames INTO args FROM pg_proc WHERE oid=target;
  IF at_begin=0 OR NOT (arg=ANY(args)) THEN RAISE EXCEPTION 'Unexpected legacy guard signature: %',name;END IF;
  EXECUTE substring(definition FROM 1 FOR at_begin+4)||E'\n PERFORM public.experience_require_legacy('||arg||E');\n'||substring(definition FROM at_begin+5);
 END LOOP;
END $$;
-- Direct native Puck saves/publication must not bypass guarded RPCs. Settings-only
-- edits remain available. Head removal/mode exit is a separately approved effect.
CREATE FUNCTION experience_authorization.guard_legacy_page() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.builder_website_guard(coalesce(NEW.merchant_id,OLD.merchant_id));
 IF TG_OP IN('INSERT','DELETE') OR (to_jsonb(NEW)->'draft_config') IS DISTINCT FROM (to_jsonb(OLD)->'draft_config') OR (to_jsonb(NEW)->'published_config') IS DISTINCT FROM (to_jsonb(OLD)->'published_config') OR (to_jsonb(NEW)->'is_published') IS DISTINCT FROM (to_jsonb(OLD)->'is_published') THEN
  IF EXISTS(SELECT 1 FROM public.experience_draft_heads WHERE merchant_id=coalesce(NEW.merchant_id,OLD.merchant_id)) OR EXISTS(SELECT 1 FROM public.experience_published_heads WHERE merchant_id=coalesce(NEW.merchant_id,OLD.merchant_id)) THEN RAISE EXCEPTION 'FULL_CODE_ACTIVE';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION experience_authorization.guard_legacy_page() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER experience_legacy_page_guard BEFORE INSERT OR UPDATE OR DELETE ON public.page_configs FOR EACH ROW EXECUTE FUNCTION experience_authorization.guard_legacy_page();
-- Owner confirmation is now a separate transaction; no public pointer changes.
CREATE TABLE experience_authorization.apply_receipts(
 intent_id uuid PRIMARY KEY REFERENCES experience_authorization.apply_intents(id),merchant_id uuid NOT NULL REFERENCES public.merchants(id),
 build_id uuid NOT NULL,version bigint NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id), committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,build_id) REFERENCES public.experience_builds(merchant_id,id)
);
CREATE INDEX experience_apply_receipt_merchant ON experience_authorization.apply_receipts(merchant_id);
CREATE INDEX experience_apply_receipt_build ON experience_authorization.apply_receipts(build_id);
CREATE INDEX experience_apply_receipt_actor ON experience_authorization.apply_receipts(actor_user_id);
ALTER TABLE experience_authorization.apply_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.apply_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.experience_confirm_draft_apply(p_intent uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i experience_authorization.apply_intents; r experience_authorization.apply_receipts; loaded jsonb;
BEGIN
 SELECT * INTO i FROM experience_authorization.apply_intents WHERE id=p_intent AND actor_user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM public.experience_require_owner(i.merchant_id,i.connection_id,i.grant_version);
 PERFORM public.builder_website_guard(i.merchant_id);
 PERFORM 1 FROM public.merchants WHERE id=i.merchant_id FOR UPDATE;
 SELECT * INTO r FROM experience_authorization.apply_receipts WHERE intent_id=i.id;
 IF FOUND THEN RETURN jsonb_build_object('buildId',r.build_id,'version',r.version);END IF;
 loaded:=public.experience_load_draft_approval(p_intent);
 IF NOT EXISTS(SELECT 1 FROM experience_authorization.approval_checks c WHERE c.intent_id=i.id AND c.effect_digest=i.effect_digest AND c.verified_at>=i.issued_at AND c.verified_at<=clock_timestamp() AND c.expires_at>clock_timestamp() AND c.expires_at<=i.expires_at) THEN RAISE EXCEPTION 'PREVIEW_REQUIRED';END IF;
 PERFORM experience_authorization.require_idle_legacy(i.merchant_id);
 INSERT INTO public.experience_draft_heads(merchant_id,build_id,version) VALUES(i.merchant_id,i.build_id,i.expected_version+1)
 ON CONFLICT(merchant_id) DO UPDATE SET build_id=EXCLUDED.build_id,version=EXCLUDED.version;
 INSERT INTO public.builder_website_revisions(merchant_id) VALUES(i.merchant_id) ON CONFLICT(merchant_id) DO UPDATE SET last_txid=txid_current();
 INSERT INTO experience_authorization.apply_receipts(intent_id,merchant_id,build_id,version,actor_user_id) VALUES(i.id,i.merchant_id,i.build_id,i.expected_version+1,auth.uid()) RETURNING * INTO r;
 RETURN jsonb_build_object('buildId',r.build_id,'version',r.version);
END $$;

CREATE TRIGGER experience_private_page_guard BEFORE INSERT OR UPDATE OR DELETE ON public.builder_page_drafts FOR EACH ROW EXECUTE FUNCTION experience_authorization.guard_legacy_page();

CREATE OR REPLACE FUNCTION public.experience_authoring_mode_for_merchant(p_merchant uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (public.check_staff_permission(auth.uid(),p_merchant,'builder','view') OR public.check_staff_permission(auth.uid(),p_merchant,'builder','edit')) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 RETURN CASE WHEN EXISTS(SELECT 1 FROM public.experience_draft_heads WHERE merchant_id=p_merchant) OR EXISTS(SELECT 1 FROM public.experience_published_heads WHERE merchant_id=p_merchant) THEN 'full-code' ELSE 'legacy' END;
END $$;
