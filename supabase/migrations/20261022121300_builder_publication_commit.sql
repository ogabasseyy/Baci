CREATE FUNCTION builder_authorization.publication_missing_items(p_merchant uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m record; f record; items jsonb:='[]';active_count int;total_count int;ng boolean;configured boolean;bank boolean;pod boolean;kora boolean;kyc boolean;
BEGIN
 SELECT slug,country,payout_currency,email,phone,support_email,support_phone,bank_code,bank_account_number INTO m FROM public.merchants WHERE id=p_merchant AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT paystack_enabled,korapay_enabled,pay_on_delivery_enabled INTO f FROM public.merchant_feature_settings WHERE merchant_id=p_merchant;
 SELECT count(*) FILTER(WHERE status='active'),count(*) INTO active_count,total_count FROM public.products WHERE merchant_id=p_merchant;
 ng:=nullif(upper(btrim(m.country)),'') IS NULL OR upper(btrim(m.country))='NG';
 configured:=coalesce(public.get_merchant_paystack_subaccount_configured(p_merchant),false);
 bank:=ng AND f.paystack_enabled IS DISTINCT FROM false AND configured AND nullif(btrim(m.bank_account_number),'') IS NOT NULL AND nullif(btrim(m.bank_code),'') IS NOT NULL;
 pod:=coalesce(f.pay_on_delivery_enabled,false);
 kora:=coalesce(f.korapay_enabled,false) AND upper(btrim(m.payout_currency)) IN('NGN','KES','GHS','ZAR','XAF','XOF');
 kyc:=NOT ng OR coalesce(public.get_merchant_identity_verified(p_merchant),false);
 IF NOT kyc THEN items:=items||jsonb_build_array('Identity verification (NIN, BVN, or CAC)');END IF;
 IF NOT(bank OR pod OR kora) THEN
  IF ng AND NOT(configured AND nullif(btrim(m.bank_account_number),'') IS NOT NULL AND nullif(btrim(m.bank_code),'') IS NOT NULL AND f.paystack_enabled=false) THEN items:=items||jsonb_build_array('Bank account details');
  ELSE items:=items||jsonb_build_array('Payment method');END IF;
 END IF;
 IF nullif(btrim(m.slug),'') IS NULL THEN items:=items||jsonb_build_array('Store URL');END IF;
 IF active_count=0 THEN items:=items||jsonb_build_array(CASE WHEN total_count>0 THEN 'At least one active product (you have '||total_count||' product(s) but none are active - go to Products and activate them)' ELSE 'At least one active product' END);END IF;
 IF nullif(btrim(m.country),'') IS NULL THEN items:=items||jsonb_build_array('Country/region setting');END IF;
 IF coalesce(nullif(btrim(m.email),''),nullif(btrim(m.phone),''),nullif(btrim(m.support_email),''),nullif(btrim(m.support_phone),'')) IS NULL THEN items:=items||jsonb_build_array('Contact information (email or phone)');END IF;
 RETURN items;
END $$;
CREATE FUNCTION public.builder_confirm_publication(p_intent uuid,p_render_check uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i builder_authorization.publication_intents%ROWTYPE; r builder_authorization.publication_receipts%ROWTYPE;p public.page_configs%ROWTYPE;d public.builder_page_drafts%ROWTYPE;source uuid;destination text;missing jsonb;stamp timestamptz:=clock_timestamp();old_state jsonb;new_public uuid;
BEGIN
 SELECT * INTO i FROM builder_authorization.publication_intents WHERE id=p_intent AND actor_user_id=auth.uid();IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 -- Fixed lock order: canonical connection → nonblocking website guard → owner
 -- row → intent/effect → page/private rows. All website/readiness writers guard.
 PERFORM builder_authorization.lock_publication(i.connection_id,i.grant_version,i.merchant_id);
 SELECT * INTO i FROM builder_authorization.publication_intents WHERE id=p_intent AND actor_user_id=auth.uid() FOR UPDATE;
 IF i.policy_namespace<>'baci.website-builder' OR i.policy_version<>1 OR i.effect_digest IS DISTINCT FROM builder_authorization.publication_digest(i.config,i.source_version,i.destination_url) THEN RAISE EXCEPTION 'APPROVAL_MISMATCH';END IF;
 SELECT 'https://'||m.slug||'.'||c.root_domain INTO destination FROM public.merchants m CROSS JOIN builder_authorization.website_configuration c WHERE m.id=i.merchant_id AND c.singleton AND c.root_domain='usebaci.com';
 IF destination IS DISTINCT FROM i.destination_url THEN RAISE EXCEPTION 'APPROVAL_MISMATCH';END IF;
 -- Reconcile exact committed effects before expiry/nonce/stale checks.
 SELECT * INTO r FROM builder_authorization.publication_receipts WHERE merchant_id=i.merchant_id AND source_version=i.source_version AND effect_digest=i.effect_digest AND policy_namespace=i.policy_namespace AND policy_version=i.policy_version;
 IF FOUND THEN
  IF r.connection_id<>i.connection_id OR r.actor_user_id<>auth.uid() THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  RETURN builder_authorization.publication_result(r.id);
 END IF;
 IF i.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'APPROVAL_ALREADY_USED';END IF;
 IF i.issued_at>clock_timestamp() OR i.expires_at<=clock_timestamp() OR i.expires_at>i.issued_at+interval '10 minutes' THEN RAISE EXCEPTION 'APPROVAL_EXPIRED';END IF;
 SELECT token INTO source FROM public.builder_website_revisions WHERE merchant_id=i.merchant_id;
 IF source IS DISTINCT FROM i.source_version THEN RETURN jsonb_build_object('status','error','code','STALE_DRAFT','error','The draft changed. Read the current revision and try again.','currentVersion','draft:'||source);END IF;
 SELECT * INTO p FROM public.page_configs WHERE merchant_id=i.merchant_id AND page_slug='home' FOR UPDATE;
 SELECT * INTO d FROM public.builder_page_drafts WHERE id=p.id AND merchant_id=i.merchant_id FOR UPDATE;
 IF NOT FOUND OR d.draft_config IS DISTINCT FROM i.config OR (SELECT template_id FROM public.merchants WHERE id=i.merchant_id) IS DISTINCT FROM 'puck' OR i.config#>>'{root,props,rendererVersion}' IS DISTINCT FROM 'baci-home-six-v1' THEN RAISE EXCEPTION 'UNSUPPORTED_TEMPLATE';END IF;
 -- Only the private, non-business verifier can attest the complete schema and
 -- inert renderer. A model/client boolean, forged hash or caller-owned row cannot.
 IF NOT EXISTS(SELECT 1 FROM builder_authorization.publication_checks x WHERE x.id=p_render_check AND x.intent_id=i.id AND x.receipt_id IS NULL AND x.kind='render' AND x.version='draft:'||i.source_version AND x.effect_digest=i.effect_digest AND x.verified_at<=clock_timestamp() AND x.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'PREVIEW_REQUIRED';END IF;
 missing:=builder_authorization.publication_missing_items(i.merchant_id);
 IF jsonb_array_length(missing)>0 THEN RETURN jsonb_build_object('storefrontId',i.merchant_id,'version','draft:'||i.source_version,'status','blocked','missingItems',missing);END IF;
 old_state:=jsonb_build_object('published_config',p.published_config,'published_seo',p.published_seo,'published_store_settings',p.published_store_settings,'published_setup_settings',p.published_setup_settings,'page_is_published',p.is_published,'merchant_is_published',(SELECT is_published FROM public.merchants WHERE id=i.merchant_id));
 IF p.published_config IS NOT NULL THEN INSERT INTO public.page_config_history(page_config_id,config,version_note) VALUES(p.id,p.published_config,'Approved ChatGPT homepage layout');END IF;
 -- Field allowlist is fixed here: pending SEO/store/setup drafts are untouched.
 UPDATE public.page_configs SET published_config=i.config,is_published=true,published_at=stamp,updated_at=stamp WHERE id=p.id;
 UPDATE public.merchants SET is_published=true WHERE id=i.merchant_id AND is_published IS DISTINCT FROM true;
 SELECT token INTO new_public FROM public.builder_published_revisions WHERE merchant_id=i.merchant_id;
 INSERT INTO builder_authorization.publication_receipts(intent_id,actor_user_id,connection_id,merchant_id,source_version,published_version,effect_digest,policy_namespace,policy_version,destination_url,old_snapshot)
 VALUES(i.id,auth.uid(),i.connection_id,i.merchant_id,i.source_version,new_public,i.effect_digest,i.policy_namespace,i.policy_version,i.destination_url,old_state) RETURNING * INTO r;
 INSERT INTO builder_authorization.publication_audit(receipt_id,actor_user_id,merchant_id,effect_digest) VALUES(r.id,auth.uid(),i.merchant_id,i.effect_digest);
 INSERT INTO builder_authorization.publication_outbox(receipt_id,actor_user_id,merchant_id) VALUES(r.id,auth.uid(),i.merchant_id);
 UPDATE builder_authorization.publication_intents SET consumed_at=stamp WHERE id=i.id;
 RETURN builder_authorization.publication_result(r.id);
END $$;
REVOKE ALL ON FUNCTION builder_authorization.publication_missing_items(uuid),public.builder_confirm_publication(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION builder_authorization.publication_missing_items(uuid),public.builder_confirm_publication(uuid,uuid) TO authenticated;
