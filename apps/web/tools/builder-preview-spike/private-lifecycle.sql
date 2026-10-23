-- Disposable adaptation contract. Every business operation runs as the caller.
-- Lock order: public page row, private draft row; AI apply additionally locks
-- its owner-protected job before these rows. No worker gets private table grants.
CREATE FUNCTION public.builder_private_load(p_merchant_id uuid,p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p.id,'draft_config',d.draft_config,
 'draft_seo',d.draft_seo,'draft_store_settings',d.draft_store_settings,
 'draft_setup_settings',d.draft_setup_settings,'published_config',p.published_config,
 'is_published',p.is_published,'updated_at',greatest(p.updated_at,d.updated_at))
 FROM public.builder_page_drafts d JOIN public.page_configs p ON p.id=d.id
 WHERE p.merchant_id=p_merchant_id AND d.merchant_id=p_merchant_id AND p.page_slug=p_slug
$$;

CREATE FUNCTION public.builder_private_save(p_merchant_id uuid,p_slug text,p_name text,
 p_config jsonb,p_seo jsonb,p_store jsonb,p_setup jsonb,p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.page_configs; d public.builder_page_drafts; stamp timestamptz; created boolean:=false;
BEGIN
 IF NOT public.check_staff_permission(auth.uid(),p_merchant_id,'builder','edit') THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
 END IF;
 SELECT * INTO p FROM public.page_configs WHERE merchant_id=p_merchant_id AND page_slug=p_slug FOR UPDATE;
 IF NOT FOUND THEN
   IF p_expected IS NOT NULL THEN RETURN jsonb_build_object('code','stale_builder_draft'); END IF;
   INSERT INTO public.page_configs(merchant_id,page_slug,page_name,is_published)
   VALUES(p_merchant_id,p_slug,p_name,false) ON CONFLICT(merchant_id,page_slug) DO NOTHING RETURNING * INTO p;
   IF NOT FOUND THEN RETURN jsonb_build_object('code','stale_builder_draft'); END IF;
   created:=true;
 END IF;
 SELECT * INTO d FROM public.builder_page_drafts WHERE id=p.id AND merchant_id=p_merchant_id FOR UPDATE;
 IF NOT created AND greatest(p.updated_at,d.updated_at) IS DISTINCT FROM p_expected THEN
   RETURN jsonb_build_object('code','stale_builder_draft');
 END IF;
 INSERT INTO public.builder_page_drafts(id,merchant_id,draft_config,draft_seo,draft_store_settings,draft_setup_settings)
 VALUES(p.id,p_merchant_id,p_config,p_seo,p_store,p_setup)
 ON CONFLICT(id) DO UPDATE SET draft_config=excluded.draft_config,draft_seo=excluded.draft_seo,
 draft_store_settings=excluded.draft_store_settings,draft_setup_settings=excluded.draft_setup_settings
 RETURNING updated_at INTO stamp;
 UPDATE public.page_configs SET page_name=p_name WHERE id=p.id;
 RETURN jsonb_build_object('id',p.id,'updated_at',greatest(p.updated_at,stamp));
END $$;

-- scope='homepage_layout' proves the narrower plugin boundary. The ordinary
-- browser scope intentionally preserves its existing SEO/settings publication.
CREATE FUNCTION public.builder_private_publish(p_merchant_id uuid,p_slug text,p_expected timestamptz,p_scope text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.page_configs; d public.builder_page_drafts; stamp timestamptz:=clock_timestamp();
BEGIN
 IF NOT public.check_staff_permission(auth.uid(),p_merchant_id,'builder','edit') THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
 END IF;
 IF p_scope NOT IN ('browser','homepage_layout') OR (p_scope='homepage_layout' AND p_slug<>'home') THEN
   RAISE EXCEPTION 'Invalid publication scope';
 END IF;
 SELECT * INTO p FROM public.page_configs WHERE merchant_id=p_merchant_id AND page_slug=p_slug FOR UPDATE;
 SELECT * INTO d FROM public.builder_page_drafts WHERE id=p.id AND merchant_id=p_merchant_id FOR UPDATE;
 IF d.draft_config IS NULL THEN RETURN jsonb_build_object('code','no_draft'); END IF;
 IF greatest(p.updated_at,d.updated_at) IS DISTINCT FROM p_expected THEN
   RETURN jsonb_build_object('code','stale_builder_draft');
 END IF;
 IF p.published_config IS NOT NULL THEN
   INSERT INTO public.page_config_history(page_config_id,config,version_note)
   VALUES(p.id,p.published_config,'Private draft feasibility publication');
 END IF;
 UPDATE public.page_configs SET published_config=d.draft_config,is_published=true,published_at=stamp,updated_at=stamp,
 published_seo=CASE WHEN p_scope='browser' THEN d.draft_seo ELSE p.published_seo END,
 published_store_settings=CASE WHEN p_scope='browser' THEN d.draft_store_settings ELSE p.published_store_settings END,
 published_setup_settings=CASE WHEN p_scope='browser' THEN d.draft_setup_settings ELSE p.published_setup_settings END
 WHERE id=p.id;
 RETURN jsonb_build_object('id',p.id,'updated_at',stamp);
END $$;

-- Native onboarding's curated initial template is intentionally public. It is
-- captured into private storage in the same transaction without public drafts.
CREATE FUNCTION public.builder_private_onboard(p_merchant_id uuid,p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE saved jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=p_merchant_id AND user_id=auth.uid()) THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.page_configs WHERE merchant_id=p_merchant_id AND page_slug='home') THEN
 RETURN jsonb_build_object('code','already_exists'); END IF;
 saved:=public.builder_private_save(p_merchant_id,'home','Home',p_config,NULL,NULL,NULL,NULL);
 IF saved ? 'code' THEN RETURN saved; END IF;
 RETURN public.builder_private_publish(p_merchant_id,'home',(saved->>'updated_at')::timestamptz,'browser');
END $$;

-- The incoming payload never chooses a starter. Normal owner RLS captures it.
-- Existing global workers receive only the already-owner-authorized job input.
CREATE FUNCTION public.builder_private_enqueue(p_merchant_id uuid,p_slug text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE snapshot jsonb; job_id uuid;
BEGIN
 IF NOT public.check_staff_permission(auth.uid(),p_merchant_id,'builder','edit') THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
 END IF;
 snapshot:=public.builder_private_load(p_merchant_id,p_slug);
 IF snapshot IS NULL OR snapshot->'draft_config' IS NULL OR snapshot->'draft_config'='null'::jsonb THEN RAISE EXCEPTION 'Starter missing'; END IF;
 INSERT INTO public.ai_jobs(merchant_id,type,status,input)
 VALUES(p_merchant_id,'storefront_layout_generation','pending',
 (p_input-'starterConfig'-'createdPageConfigUpdatedAt'-'pageSlug') || jsonb_build_object(
 'pageSlug',p_slug,'starterConfig',snapshot->'draft_config',
 'createdPageConfigUpdatedAt',snapshot->'updated_at')) RETURNING id INTO job_id;
 RETURN jsonb_build_object('id',job_id);
END $$;

-- Name propagation into private content happens only through this normal client
-- transaction. The legacy privileged trigger continues to touch public content.
CREATE FUNCTION public.builder_private_rename(p_merchant_id uuid,p_old text,p_new text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE normalized_name text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=p_merchant_id AND user_id=auth.uid()) THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
 END IF;
 -- Lock all page rows before private rows, matching the lifecycle lock order.
 PERFORM 1 FROM public.page_configs WHERE merchant_id=p_merchant_id ORDER BY id FOR UPDATE;
 UPDATE public.merchants SET business_name=p_new WHERE id=p_merchant_id AND business_name=p_old;
 IF NOT FOUND THEN RAISE EXCEPTION 'Merchant changed' USING ERRCODE='40001'; END IF;
 SELECT business_name INTO normalized_name FROM public.merchants WHERE id=p_merchant_id;
 UPDATE public.builder_page_drafts SET draft_config=public.rewrite_config_business_name(draft_config,p_old,normalized_name)
 WHERE merchant_id=p_merchant_id;
END $$;

REVOKE ALL ON FUNCTION public.builder_private_load(uuid,text),public.builder_private_save(uuid,text,text,jsonb,jsonb,jsonb,jsonb,timestamptz),
public.builder_private_publish(uuid,text,timestamptz,text),public.builder_private_onboard(uuid,jsonb),
public.builder_private_enqueue(uuid,text,jsonb),public.builder_private_rename(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_private_load(uuid,text),public.builder_private_save(uuid,text,text,jsonb,jsonb,jsonb,jsonb,timestamptz),
public.builder_private_publish(uuid,text,timestamptz,text),public.builder_private_onboard(uuid,jsonb),
public.builder_private_enqueue(uuid,text,jsonb),public.builder_private_rename(uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
