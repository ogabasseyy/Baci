-- Install a coordinated operator-only cutover, never contract on ordinary rollout.
-- SECURITY INVOKER: caller must own the affected schema objects. No application,
-- service-role, or broker role receives permission to call this procedure.
CREATE PROCEDURE builder_authorization.cutover_private_drafts()
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $cutover$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.page_configs'::regclass AND attname='draft_config' AND NOT attisdropped) THEN
  RAISE EXCEPTION 'builder_private_cutover_already_applied';
 END IF;
-- Explicit deployment gate: apply only in a coordinated maintenance window.
-- Compatible app/worker artifact must be ready, old processes drained and rollback
-- must use private adapters. This setting is an operator assertion, not user authority.
LOCK TABLE public.ai_jobs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF current_setting('baci.builder_private_cutover',true) IS DISTINCT FROM 'approved' THEN
  RAISE EXCEPTION 'builder_private_cutover_requires_coordinated_release';
 END IF;
 IF EXISTS(SELECT 1 FROM public.ai_jobs WHERE type='storefront_layout_generation' AND status IN('pending','running')) THEN
  RAISE EXCEPTION 'builder_private_cutover_requires_legacy_job_drain';
 END IF;
END $$;
LOCK TABLE public.page_configs IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.builder_page_drafts IN ACCESS EXCLUSIVE MODE;
INSERT INTO public.builder_page_drafts(id,merchant_id,draft_config,draft_seo,draft_store_settings,draft_setup_settings,updated_at)
SELECT id,merchant_id,draft_config,draft_seo,draft_store_settings,draft_setup_settings,coalesce(updated_at,clock_timestamp())
FROM public.page_configs
ON CONFLICT(id) DO UPDATE SET draft_config=excluded.draft_config,draft_seo=excluded.draft_seo,
draft_store_settings=excluded.draft_store_settings,draft_setup_settings=excluded.draft_setup_settings
WHERE public.builder_page_drafts.updated_at < excluded.updated_at;
ALTER TABLE public.page_configs DROP COLUMN draft_config,DROP COLUMN draft_seo,
 DROP COLUMN draft_store_settings,DROP COLUMN draft_setup_settings;
-- Preserve existing privileged PUBLIC-only name reconciliation. This function
-- gains no new table reference, grant, role membership or private-draft authority.
CREATE OR REPLACE FUNCTION public.propagate_merchant_business_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.business_name IS DISTINCT FROM NEW.business_name AND OLD.business_name IS NOT NULL
 AND btrim(OLD.business_name)<>'' AND NEW.business_name IS NOT NULL AND btrim(NEW.business_name)<>'' THEN
 UPDATE public.page_configs pc SET published_config=public.rewrite_config_business_name(pc.published_config,OLD.business_name,NEW.business_name),updated_at=clock_timestamp()
 WHERE pc.merchant_id=NEW.id AND pc.published_config IS DISTINCT FROM public.rewrite_config_business_name(pc.published_config,OLD.business_name,NEW.business_name);
 END IF;
 RETURN NULL;
END $$;
-- Native apply needs only its existing owner-scoped completion marker. Keep
-- job payload/status immutable to authenticated UPDATE. Existing permitted
-- builder staff retain native apply authority through the same normal RLS.
REVOKE UPDATE ON public.ai_jobs FROM authenticated;
GRANT UPDATE(result_applied_at,metadata) ON public.ai_jobs TO authenticated;
CREATE POLICY builder_private_mark_job_applied ON public.ai_jobs FOR UPDATE TO authenticated
USING (type='storefront_layout_generation' AND status='completed'
 AND public.check_staff_permission(auth.uid(),merchant_id,'builder','edit'))
WITH CHECK (type='storefront_layout_generation' AND status='completed'
 AND public.check_staff_permission(auth.uid(),merchant_id,'builder','edit'));
CREATE OR REPLACE FUNCTION public.apply_ai_storefront_draft(
  p_job_id uuid,
  p_merchant_id uuid,
  p_page_slug text,
  p_generated_config jsonb,
  p_generated_against_updated_at timestamptz,
  p_force boolean DEFAULT false
)
RETURNS TABLE (
  applied boolean,
  code text,
  page_config_id uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_authorized boolean := false;
  v_job_id uuid;
  v_result_applied_at timestamptz;
  v_page_config_id uuid;
  v_current_updated_at timestamptz;
  v_next_updated_at timestamptz;
  v_apply_timestamp timestamptz;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN QUERY SELECT false, 'unauthorized'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  PERFORM public.builder_website_guard(p_merchant_id);
  SELECT EXISTS (
      SELECT 1
      FROM public.merchants AS m
      WHERE m.id = p_merchant_id
        AND m.user_id = v_actor_id
    )
    OR public.check_staff_permission(v_actor_id, p_merchant_id, 'builder', 'edit')
    INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN QUERY SELECT false, 'forbidden'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT j.id, j.result_applied_at
    INTO v_job_id, v_result_applied_at
    FROM public.ai_jobs AS j
    WHERE j.id = p_job_id
      AND j.merchant_id = p_merchant_id
      AND j.type = 'storefront_layout_generation'
      AND j.status = 'completed'
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'job_not_found'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_result_applied_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'job_already_applied'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  PERFORM 1 FROM public.page_configs WHERE merchant_id=p_merchant_id AND page_slug=p_page_slug FOR UPDATE;

  SELECT pc.id, greatest(pc.updated_at,published.updated_at)
    INTO v_page_config_id, v_current_updated_at
    FROM public.builder_page_drafts AS pc JOIN public.page_configs AS published ON published.id=pc.id
    WHERE pc.merchant_id = p_merchant_id
      AND published.page_slug = p_page_slug
    FOR UPDATE OF pc;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'page_config_not_found'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF NOT p_force AND v_current_updated_at IS DISTINCT FROM p_generated_against_updated_at THEN
    RETURN QUERY SELECT false, 'ai_draft_stale'::text, v_page_config_id, v_current_updated_at;
    RETURN;
  END IF;

  v_apply_timestamp := clock_timestamp();

  UPDATE public.builder_page_drafts AS pc
    SET draft_config = p_generated_config,
        updated_at = v_apply_timestamp
    WHERE pc.id = v_page_config_id
    RETURNING pc.updated_at INTO v_next_updated_at;

  UPDATE public.ai_jobs AS j
    SET result_applied_at = v_apply_timestamp,
        metadata = COALESCE(j.metadata, '{}'::jsonb)
          || jsonb_build_object('lastAppliedPageConfigUpdatedAt', v_next_updated_at)
    WHERE j.id = p_job_id;

  RETURN QUERY SELECT true, NULL::text, v_page_config_id, v_next_updated_at;
END;
$$;

ALTER FUNCTION public.apply_ai_storefront_draft(
  uuid, uuid, text, jsonb, timestamptz, boolean
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.apply_ai_storefront_draft(
  uuid, uuid, text, jsonb, timestamptz, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.apply_ai_storefront_draft(
  uuid, uuid, text, jsonb, timestamptz, boolean
) TO authenticated;

-- This pure JSON transform is usable by authenticated rename under RLS; it
-- neither queries tables nor grants the legacy privileged trigger draft access.
REVOKE ALL ON FUNCTION public.apply_ai_storefront_draft(uuid,uuid,text,jsonb,timestamptz,boolean) FROM service_role,anon;
GRANT EXECUTE ON FUNCTION public.rewrite_config_business_name(jsonb,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';


-- Fail closed for any old enqueue that was waiting during the maintenance window.
CREATE FUNCTION public.builder_require_captured_starter() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.type='storefront_layout_generation' AND (NOT NEW.input ? 'starterConfig' OR NEW.input->'starterConfig'='null'::jsonb) THEN
  RAISE EXCEPTION 'private_enqueue_required' USING ERRCODE='40001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER builder_require_captured_starter BEFORE INSERT ON public.ai_jobs FOR EACH ROW EXECUTE FUNCTION public.builder_require_captured_starter();
REVOKE ALL ON FUNCTION public.builder_require_captured_starter() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_require_captured_starter() TO authenticated;

-- Preserve the original identity implementation and its PUBLIC-only authority.
-- It is no longer exposed as a directly callable Data API RPC. Both old and new
-- public callers enter a normal-user wrapper before private reconciliation.
ALTER FUNCTION public.update_merchant_identity_settings(uuid,jsonb,timestamptz) SET SCHEMA builder_authorization;
ALTER FUNCTION builder_authorization.update_merchant_identity_settings(uuid,jsonb,timestamptz) RENAME TO guarded_merchant_identity_settings;
CREATE FUNCTION public.update_merchant_identity_settings(p_merchant_id uuid,p_settings jsonb,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.builder_private_update_identity(p_merchant_id,p_settings,p_expected_updated_at);
$$;
REVOKE ALL ON FUNCTION public.update_merchant_identity_settings(uuid,jsonb,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.update_merchant_identity_settings(uuid,jsonb,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';

END;
$cutover$;
REVOKE ALL ON PROCEDURE builder_authorization.cutover_private_drafts() FROM PUBLIC,anon,authenticated,service_role,baci_builder_auth_storage;
