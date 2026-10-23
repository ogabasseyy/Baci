-- Existing domain helpers assume one normalized owner per domain. Fail migration
-- on historical duplicates; never repair or reassign another tenant implicitly.
CREATE UNIQUE INDEX builder_domains_normalized_reservation_idx ON public.domains(lower(btrim(domain)));
-- Disabled application surface; all functions run as the normal linked user under RLS.
CREATE TABLE builder_authorization.mutation_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES builder_authorization.connections(id) ON DELETE CASCADE,
 merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE, tool text NOT NULL CHECK(tool IN('create','commit')),
 retry_key uuid NOT NULL, input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
 version uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_user_id,connection_id,tool,retry_key)
);
CREATE INDEX builder_evidence_connection_idx ON builder_authorization.mutation_evidence(connection_id);
CREATE INDEX builder_evidence_merchant_idx ON builder_authorization.mutation_evidence(merchant_id);
ALTER TABLE builder_authorization.mutation_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY builder_evidence_owner ON builder_authorization.mutation_evidence FOR SELECT TO authenticated USING(actor_user_id=auth.uid());
CREATE POLICY builder_evidence_insert ON builder_authorization.mutation_evidence FOR INSERT TO authenticated WITH CHECK(actor_user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.user_id=auth.uid()) AND EXISTS(SELECT 1 FROM builder_authorization.connections c WHERE c.id=connection_id AND c.actor_user_id=auth.uid() AND c.status='active' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND 'storefront.write'=ANY(c.scopes) AND merchant_id=ANY(c.allowed_merchant_ids)) AND EXISTS(SELECT 1 FROM public.builder_website_revisions r WHERE r.merchant_id=mutation_evidence.merchant_id AND r.token=mutation_evidence.version));
REVOKE ALL ON builder_authorization.mutation_evidence FROM PUBLIC,anon,service_role;
GRANT SELECT,INSERT ON builder_authorization.mutation_evidence TO authenticated;
CREATE TABLE public.builder_edit_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES builder_authorization.connections(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, grant_version bigint NOT NULL,
 source_version uuid NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','ready','applied','failed','conflict')),
 input jsonb NOT NULL, candidate jsonb, lease_id uuid, lease_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day'
);
CREATE INDEX builder_operations_merchant_idx ON public.builder_edit_operations(merchant_id);
CREATE INDEX builder_operations_connection_idx ON public.builder_edit_operations(connection_id,status);
CREATE INDEX builder_operations_actor_idx ON public.builder_edit_operations(actor_user_id);
ALTER TABLE public.builder_edit_operations ENABLE ROW LEVEL SECURITY;
-- Transitions are deliberately not granted until Task 5 defines and tests them.
CREATE POLICY builder_operations_read ON public.builder_edit_operations FOR SELECT TO authenticated USING(actor_user_id=auth.uid() AND EXISTS(SELECT 1 FROM builder_authorization.connections c WHERE c.id=connection_id AND c.actor_user_id=auth.uid() AND c.status='active' AND c.revoked_at IS NULL AND c.expires_at>now() AND c.grant_version=builder_edit_operations.grant_version AND merchant_id=ANY(c.allowed_merchant_ids)));
REVOKE ALL ON public.builder_edit_operations FROM PUBLIC,anon,service_role;
GRANT SELECT ON public.builder_edit_operations TO authenticated;
CREATE TABLE builder_authorization.website_configuration (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), root_domain text NOT NULL CHECK(root_domain ~ '^[a-z0-9.-]+$')
);
INSERT INTO builder_authorization.website_configuration VALUES(true,'usebaci.com');
ALTER TABLE builder_authorization.website_configuration ENABLE ROW LEVEL SECURITY;
CREATE POLICY builder_configuration_read ON builder_authorization.website_configuration FOR SELECT TO authenticated USING(true);
REVOKE ALL ON builder_authorization.website_configuration FROM PUBLIC,anon,service_role;
GRANT SELECT ON builder_authorization.website_configuration TO authenticated;

-- The new connector must never edit against a half-migrated public-draft schema.
CREATE FUNCTION public.builder_require_private_storage() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.page_configs'::regclass AND attname='draft_config' AND NOT attisdropped) THEN
  RAISE EXCEPTION 'OPERATION_FAILED';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.builder_require_private_storage() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_require_private_storage() TO authenticated;

-- Serialize with revoke/version changes before touching a website or reading replay evidence.
CREATE FUNCTION public.builder_lock_connection(p_connection uuid,p_version bigint,p_merchant uuid,p_create boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c builder_authorization.connections%ROWTYPE;
BEGIN
 PERFORM public.builder_require_private_storage();
 SELECT * INTO c FROM builder_authorization.connections WHERE id=p_connection AND actor_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR c.status<>'active' OR c.revoked_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR c.grant_version<>p_version THEN
  RAISE EXCEPTION 'CONNECTION_REVOKED' USING ERRCODE='42501';
 END IF;
 IF NOT 'storefront.write'=ANY(c.scopes) THEN RAISE EXCEPTION 'INSUFFICIENT_SCOPE' USING ERRCODE='42501'; END IF;
 IF p_create THEN
  IF NOT c.allow_create_store THEN RAISE EXCEPTION 'INSUFFICIENT_SCOPE' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT p_merchant=ANY(c.allowed_merchant_ids) OR NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=p_merchant AND user_id=auth.uid()) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='42501'; END IF;
 END IF;
END $$;

CREATE FUNCTION public.builder_create_draft(p_connection uuid,p_version bigint,p_retry_key uuid,p_input jsonb,p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m public.merchants%ROWTYPE; e builder_authorization.mutation_evidence%ROWTYPE; page_id uuid; rev uuid; root_domain text; host text; target_ids uuid[]; conflicting_constraint text;
 digest text:=encode(sha256(convert_to(jsonb_build_object('input',p_input,'config',p_config)::text,'UTF8')),'hex');
BEGIN
 PERFORM public.builder_lock_connection(p_connection,p_version,NULL,true);
 -- Across separate connections, only one first store may be provisioned for this actor.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('baci.owner:'||auth.uid()::text,0)) THEN RAISE EXCEPTION 'website_busy' USING ERRCODE='40001'; END IF;
 SELECT * INTO e FROM builder_authorization.mutation_evidence WHERE actor_user_id=auth.uid() AND connection_id=p_connection AND tool='create' AND retry_key=p_retry_key;
 IF FOUND THEN
  IF e.input_digest<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  PERFORM public.builder_lock_connection(p_connection,p_version,e.merchant_id,false);
  IF e.created_at<now()-interval '7 days' THEN RAISE EXCEPTION 'OPERATION_FAILED'; END IF;
  RETURN jsonb_build_object('storefrontId',e.merchant_id,'version','draft:'||e.version,'changedPages',jsonb_build_array('home'),'status','draft');
 END IF;
 IF p_input->>'requestedSlug' IS NULL OR p_input->>'requestedSlug' !~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' OR public.is_reserved_merchant_slug(p_input->>'requestedSlug') OR p_input->>'requestedSlug' IN('auth','mcp')
  OR length(p_input->>'businessName') NOT BETWEEN 2 AND 200 OR p_input->>'businessType' NOT IN('fashion','electronics','home-goods','health-beauty','handmade','food-beverage','hair-extensions','pharmaceuticals')
  OR coalesce(p_config#>>'{root,props,rendererVersion}','')<>'baci-home-six-v1' OR jsonb_typeof(p_config->'content')<>'array' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT id,user_id,business_name,business_type,slug,is_published INTO m.id,m.user_id,m.business_name,m.business_type,m.slug,m.is_published FROM public.merchants WHERE user_id=auth.uid() FOR UPDATE;
 IF FOUND THEN
  -- Any configured homepage or completed identity is established; never replace it.
  IF (nullif(btrim(m.business_name),'') IS NOT NULL AND nullif(btrim(m.business_type),'') IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.page_configs WHERE merchant_id=m.id) OR coalesce(m.is_published,false) THEN RAISE EXCEPTION 'STORE_ALREADY_EXISTS'; END IF;
  IF nullif(m.slug,'') IS NOT NULL AND m.slug<>p_input->>'requestedSlug' THEN RAISE EXCEPTION 'SLUG_IMMUTABLE'; END IF;
 ELSE
  m.id:=gen_random_uuid();
 END IF;
 SELECT allowed_merchant_ids INTO target_ids FROM builder_authorization.connections WHERE id=p_connection;
 IF cardinality(target_ids)>0 AND target_ids<>ARRAY[m.id] THEN RAISE EXCEPTION 'INSUFFICIENT_SCOPE'; END IF;
 PERFORM public.builder_website_guard(m.id);
 IF m.user_id IS NULL THEN
  INSERT INTO public.merchants(id,user_id,email,business_name,business_type,country,slug,template_id,is_published)
  VALUES(m.id,auth.uid(),auth.jwt()->>'email',p_input->>'businessName',p_input->>'businessType',p_input->>'country',p_input->>'requestedSlug','puck',false);
 ELSE
  UPDATE public.merchants SET business_name=p_input->>'businessName',business_type=p_input->>'businessType',country=p_input->>'country',slug=p_input->>'requestedSlug',template_id='puck',is_published=false WHERE id=m.id AND user_id=auth.uid();
 END IF;
 SELECT w.root_domain INTO root_domain FROM builder_authorization.website_configuration w WHERE singleton;
 IF root_domain IS NULL THEN RAISE EXCEPTION 'OPERATION_FAILED'; END IF;
 host:=(p_input->>'requestedSlug')||'.'||root_domain;
 INSERT INTO public.domains(merchant_id,domain,tld,domain_type,status,is_primary)
 SELECT m.id,host,'.'||root_domain,'subdomain','active',NOT EXISTS(SELECT 1 FROM public.domains WHERE merchant_id=m.id AND is_primary)
 WHERE NOT EXISTS(SELECT 1 FROM public.domains WHERE domain=host AND merchant_id=m.id);
 INSERT INTO public.page_configs(merchant_id,page_slug,page_name,is_published) VALUES(m.id,'home','Home',false) RETURNING id INTO page_id;
 INSERT INTO public.builder_page_drafts(id,merchant_id,draft_config) VALUES(page_id,m.id,p_config);
 INSERT INTO public.builder_website_revisions(merchant_id) VALUES(m.id) ON CONFLICT(merchant_id) DO UPDATE SET last_txid=txid_current() RETURNING token INTO rev;
 IF cardinality(target_ids)=0 THEN UPDATE builder_authorization.connections SET allowed_merchant_ids=ARRAY[m.id] WHERE id=p_connection; END IF;
 INSERT INTO builder_authorization.mutation_evidence(actor_user_id,connection_id,merchant_id,tool,retry_key,input_digest,version) VALUES(auth.uid(),p_connection,m.id,'create',p_retry_key,digest,rev);
 RETURN jsonb_build_object('storefrontId',m.id,'version','draft:'||rev,'changedPages',jsonb_build_array('home'),'status','draft');
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS conflicting_constraint=CONSTRAINT_NAME;
 IF conflicting_constraint IN('idx_merchants_slug','merchants_slug_key','builder_domains_normalized_reservation_idx','domains_active_normalized_domain_uidx','domains_domain_key') THEN
  RAISE EXCEPTION 'SLUG_UNAVAILABLE';
 END IF;
 RAISE EXCEPTION 'OPERATION_FAILED';
END $$;

CREATE FUNCTION public.builder_commit_draft(p_connection uuid,p_version bigint,p_merchant uuid,p_expected uuid,p_retry_key uuid,p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e builder_authorization.mutation_evidence%ROWTYPE; current_rev uuid; page_id uuid;
 digest text:=encode(sha256(convert_to(jsonb_build_object('merchant',p_merchant,'expected',p_expected,'config',p_config)::text,'UTF8')),'hex');
BEGIN
 PERFORM public.builder_lock_connection(p_connection,p_version,p_merchant,false);
 PERFORM public.builder_website_guard(p_merchant);
 SELECT * INTO e FROM builder_authorization.mutation_evidence WHERE actor_user_id=auth.uid() AND connection_id=p_connection AND tool='commit' AND retry_key=p_retry_key;
 IF FOUND THEN
  IF e.input_digest<>digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  IF e.created_at<now()-interval '7 days' THEN RAISE EXCEPTION 'OPERATION_FAILED'; END IF;
  RETURN jsonb_build_object('storefrontId',p_merchant,'version','draft:'||e.version,'changedPages',jsonb_build_array('home'),'status','draft');
 END IF;
 SELECT token INTO current_rev FROM public.builder_website_revisions WHERE merchant_id=p_merchant;
 IF current_rev IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','error','code','STALE_DRAFT','currentVersion','draft:'||current_rev); END IF;
 IF coalesce(p_config#>>'{root,props,rendererVersion}','')<>'baci-home-six-v1' OR jsonb_typeof(p_config->'content')<>'array' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=p_merchant AND user_id=auth.uid() AND template_id='puck') THEN RAISE EXCEPTION 'UNSUPPORTED_TEMPLATE'; END IF;
 SELECT id INTO page_id FROM public.page_configs WHERE merchant_id=p_merchant AND page_slug='home' FOR UPDATE;
 IF page_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 INSERT INTO public.builder_page_drafts(id,merchant_id,draft_config) VALUES(page_id,p_merchant,p_config) ON CONFLICT(id) DO UPDATE SET draft_config=excluded.draft_config;
 SELECT token INTO current_rev FROM public.builder_website_revisions WHERE merchant_id=p_merchant;
 INSERT INTO builder_authorization.mutation_evidence(actor_user_id,connection_id,merchant_id,tool,retry_key,input_digest,version) VALUES(auth.uid(),p_connection,p_merchant,'commit',p_retry_key,digest,current_rev);
 RETURN jsonb_build_object('storefrontId',p_merchant,'version','draft:'||current_rev,'changedPages',jsonb_build_array('home'),'status','draft');
END $$;
REVOKE ALL ON FUNCTION public.builder_lock_connection(uuid,bigint,uuid,boolean),public.builder_create_draft(uuid,bigint,uuid,jsonb,jsonb),public.builder_commit_draft(uuid,bigint,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_lock_connection(uuid,bigint,uuid,boolean),public.builder_create_draft(uuid,bigint,uuid,jsonb,jsonb),public.builder_commit_draft(uuid,bigint,uuid,uuid,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.builder_read_storefronts(p_connection uuid,p_version bigint,p_merchant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c builder_authorization.connections%ROWTYPE; result jsonb;
BEGIN
 PERFORM public.builder_require_private_storage();
 SELECT * INTO c FROM builder_authorization.connections WHERE id=p_connection AND actor_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR c.status<>'active' OR c.revoked_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR c.grant_version<>p_version THEN RAISE EXCEPTION 'CONNECTION_REVOKED' USING ERRCODE='42501'; END IF;
 IF NOT 'storefront.read'=ANY(c.scopes) THEN RAISE EXCEPTION 'INSUFFICIENT_SCOPE' USING ERRCODE='42501'; END IF;
 IF p_merchant IS NOT NULL AND NOT p_merchant=ANY(c.allowed_merchant_ids) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'business_name',m.business_name,'slug',m.slug,'template_id',m.template_id,
 'draft_config',d.draft_config,'version',CASE WHEN r.token IS NULL THEN NULL ELSE 'draft:'||r.token END,'is_published',coalesce(p.is_published,false))), '[]'::jsonb)
 INTO result FROM public.merchants m
 LEFT JOIN public.page_configs p ON p.merchant_id=m.id AND p.page_slug='home'
 LEFT JOIN public.builder_page_drafts d ON d.id=p.id AND d.merchant_id=m.id
 LEFT JOIN public.builder_website_revisions r ON r.merchant_id=m.id
 WHERE m.user_id=auth.uid() AND m.id=ANY(c.allowed_merchant_ids) AND (p_merchant IS NULL OR m.id=p_merchant);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.builder_read_storefronts(uuid,bigint,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_read_storefronts(uuid,bigint,uuid) TO authenticated;
