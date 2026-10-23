-- Match canonical native onboarding country currency; never repair existing established stores.
CREATE OR REPLACE FUNCTION public.builder_create_draft(p_connection uuid,p_version bigint,p_retry_key uuid,p_input jsonb,p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m public.merchants%ROWTYPE; e builder_authorization.mutation_evidence%ROWTYPE; page_id uuid; rev uuid; root_domain text; host text; target_ids uuid[]; conflicting_constraint text; v_payout_currency text;
 digest text:=encode(sha256(convert_to(jsonb_build_object('input',p_input,'config',p_config)::text,'UTF8')),'hex');
BEGIN
 v_payout_currency := CASE p_input->>'country'
    WHEN 'US' THEN 'USD'
    WHEN 'NG' THEN 'NGN'
    WHEN 'GB' THEN 'GBP'
    WHEN 'CA' THEN 'CAD'
    WHEN 'AU' THEN 'AUD'
    WHEN 'DE' THEN 'EUR'
    WHEN 'FR' THEN 'EUR'
    WHEN 'JP' THEN 'JPY'
    WHEN 'IN' THEN 'INR'
    WHEN 'BR' THEN 'BRL'
    WHEN 'ZA' THEN 'ZAR'
    WHEN 'AE' THEN 'AED'
    WHEN 'KE' THEN 'KES'
    WHEN 'GH' THEN 'GHS'
    WHEN 'EG' THEN 'EGP'
    WHEN 'CM' THEN 'XAF'
    WHEN 'CI' THEN 'XOF'
    WHEN 'SN' THEN 'XOF'
    WHEN 'BF' THEN 'XOF'
    WHEN 'RW' THEN 'RWF'
    WHEN 'TZ' THEN 'TZS'
    WHEN 'UG' THEN 'UGX'
    ELSE NULL
  END;
 IF v_payout_currency IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
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
  INSERT INTO public.merchants(id,user_id,email,business_name,business_type,country,payout_currency,slug,template_id,is_published)
  VALUES(m.id,auth.uid(),auth.jwt()->>'email',p_input->>'businessName',p_input->>'businessType',p_input->>'country',v_payout_currency,p_input->>'requestedSlug','puck',false);
 ELSE
  UPDATE public.merchants SET business_name=p_input->>'businessName',business_type=p_input->>'businessType',country=p_input->>'country',payout_currency=v_payout_currency,slug=p_input->>'requestedSlug',template_id='puck',is_published=false WHERE id=m.id AND user_id=auth.uid();
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

