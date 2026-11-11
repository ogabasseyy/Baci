-- Pair bounded timestamps from one statement clock; clock_timestamp defaults can differ by microseconds.
ALTER TABLE experience_authorization.apply_intents ALTER COLUMN issued_at SET DEFAULT statement_timestamp(), ALTER COLUMN expires_at SET DEFAULT statement_timestamp()+interval '10 minutes';
-- Disabled runtime slice: immutable intents/receipts, normal-owner RPCs only.
CREATE TABLE experience_authorization.lifecycle_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES public.merchants(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 connection_id uuid REFERENCES builder_authorization.connections(id),grant_version bigint,retry_key uuid NOT NULL,
 action text NOT NULL CHECK(action IN('publish','rollback','draft-only','restore-legacy','unpublish-legacy-draft')),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=4096),effect_digest text NOT NULL CHECK(effect_digest ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL,issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '10 minutes',
 CHECK((connection_id IS NULL)=(grant_version IS NULL)),CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '10 minutes')
);
CREATE UNIQUE INDEX experience_lifecycle_retry ON experience_authorization.lifecycle_intents(merchant_id,actor_user_id,coalesce(connection_id,'00000000-0000-0000-0000-000000000000'::uuid),retry_key);
CREATE INDEX experience_lifecycle_actor ON experience_authorization.lifecycle_intents(actor_user_id);
CREATE INDEX experience_lifecycle_connection ON experience_authorization.lifecycle_intents(connection_id);
CREATE INDEX experience_lifecycle_merchant ON experience_authorization.lifecycle_intents(merchant_id);
ALTER TABLE experience_authorization.lifecycle_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.lifecycle_intents FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE experience_authorization.lifecycle_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intent_id uuid NOT NULL UNIQUE REFERENCES experience_authorization.lifecycle_intents(id),
 merchant_id uuid NOT NULL REFERENCES public.merchants(id),build_id uuid,publication_revision bigint NOT NULL,
 published_token uuid,action text NOT NULL,committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,build_id) REFERENCES public.experience_builds(merchant_id,id)
);
CREATE INDEX experience_lifecycle_receipt_merchant ON experience_authorization.lifecycle_receipts(merchant_id);
CREATE INDEX experience_lifecycle_receipt_build ON experience_authorization.lifecycle_receipts(build_id);
ALTER TABLE experience_authorization.lifecycle_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.lifecycle_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE experience_authorization.lifecycle_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intent_id uuid NOT NULL REFERENCES experience_authorization.lifecycle_intents(id),
 receipt_id uuid REFERENCES experience_authorization.lifecycle_receipts(id),kind text NOT NULL CHECK(kind IN('render','public')),
 effect_digest text NOT NULL CHECK(effect_digest ~ '^[a-f0-9]{64}$'),marker_digest text NOT NULL CHECK(marker_digest ~ '^[a-f0-9]{64}$'),
 verified_at timestamptz NOT NULL DEFAULT statement_timestamp(),expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '5 minutes',
 CHECK(expires_at>verified_at AND expires_at<=verified_at+interval '10 minutes'),CHECK((kind='public')=(receipt_id IS NOT NULL))
);
CREATE INDEX experience_lifecycle_check_intent ON experience_authorization.lifecycle_checks(intent_id);
CREATE INDEX experience_lifecycle_check_receipt ON experience_authorization.lifecycle_checks(receipt_id);
ALTER TABLE experience_authorization.lifecycle_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.lifecycle_checks FROM PUBLIC,anon,authenticated,service_role;
GRANT INSERT ON experience_authorization.lifecycle_checks TO baci_experience_verifier;
CREATE POLICY independent_lifecycle_proof ON experience_authorization.lifecycle_checks FOR INSERT TO baci_experience_verifier WITH CHECK(true);
-- A normal client cannot manufacture proof, receipts or an effective policy.
CREATE FUNCTION experience_authorization.lifecycle_snapshot(p_merchant uuid,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.experience_builds; manifest jsonb; legacy jsonb; files jsonb; js bytea; css bytea; result jsonb; target uuid; draft bigint; pub bigint;
BEGIN
 SELECT coalesce((SELECT version FROM public.experience_draft_heads WHERE merchant_id=p_merchant),0),coalesce((SELECT publication_revision FROM public.experience_published_heads WHERE merchant_id=p_merchant),0) INTO draft,pub;
 IF (p_payload->>'expectedDraftVersion')::bigint IS DISTINCT FROM draft OR (p_payload->>'expectedPublishedVersion')::bigint IS DISTINCT FROM pub THEN RAISE EXCEPTION 'STALE_VERSION';END IF;
 result:=jsonb_build_object('namespace','baci.full-code.lifecycle.v1','action',p_action,'merchant',p_merchant,'payload',p_payload,'draft',draft,'published',pub,
 'website',(SELECT token FROM public.builder_website_revisions WHERE merchant_id=p_merchant),
 'publishedToken',(SELECT token FROM public.builder_published_revisions WHERE merchant_id=p_merchant),
 'sourceHead',(SELECT jsonb_build_object('artifact',artifact_id,'version',version) FROM public.experience_source_heads WHERE merchant_id=p_merchant),
 'catalogGeneration',(SELECT generation FROM public.experience_catalog_generations WHERE merchant_id=p_merchant),
 'enrolled',(SELECT coalesce(premium_features,'[]'::jsonb) FROM public.merchants WHERE id=p_merchant));
 IF p_action IN('publish','rollback') THEN
  target:=(p_payload->>'buildId')::uuid;
  SELECT * INTO b FROM public.experience_builds WHERE id=target AND merchant_id=p_merchant;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  SELECT a.manifest INTO manifest FROM public.experience_jobs j JOIN public.experience_artifacts a ON a.id=j.artifact_id AND a.merchant_id=j.merchant_id
   WHERE j.id=b.job_id AND j.merchant_id=p_merchant AND j.status='finalized' AND EXISTS(SELECT 1 FROM public.experience_evidence e WHERE e.job_id=j.id AND e.attempt_nonce=j.attempt_nonce AND e.build_digest=b.build_digest AND e.host_origin=b.host_origin);
  IF manifest IS NULL OR manifest->>'format' IS DISTINCT FROM 'baci.experience/v2' OR manifest->>'runtime' IS DISTINCT FROM 'react-browser-sandbox/v1' OR manifest->>'sdkVersion' IS DISTINCT FROM 'commerce-bridge/v1' THEN RAISE EXCEPTION 'INCOMPATIBLE_POLICY';END IF;
  IF p_action='publish' AND EXISTS(SELECT 1 FROM public.experience_source_heads s JOIN public.experience_jobs j ON j.id=b.job_id WHERE s.merchant_id=p_merchant AND s.artifact_id<>j.artifact_id) THEN RAISE EXCEPTION 'STALE_SOURCE';END IF;
  IF p_action='publish' AND NOT EXISTS(SELECT 1 FROM public.experience_draft_heads h JOIN experience_authorization.apply_receipts r ON r.merchant_id=h.merchant_id AND r.build_id=h.build_id AND r.version=h.version WHERE h.merchant_id=p_merchant AND h.build_id=b.id) THEN RAISE EXCEPTION 'DRAFT_APPROVAL_REQUIRED';END IF;
  IF p_action='rollback' AND NOT EXISTS(SELECT 1 FROM experience_authorization.lifecycle_receipts WHERE merchant_id=p_merchant AND build_id=b.id AND action IN('publish','rollback')) THEN RAISE EXCEPTION 'ROLLBACK_NOT_RETAINED';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(manifest->'capabilities') c WHERE c NOT IN('catalog.read','cart.read-public','cart.mutate','checkout.prepare','checkout.open','navigation')) THEN RAISE EXCEPTION 'INCOMPATIBLE_POLICY';END IF;
  SELECT bytes INTO js FROM public.experience_build_files WHERE build_id=b.id AND merchant_id=p_merchant AND path='app.js';
  SELECT bytes INTO css FROM public.experience_build_files WHERE build_id=b.id AND merchant_id=p_merchant AND path='app.css';
  IF js IS NULL OR css IS NULL OR encode(sha256(js||decode('00','hex')||css),'hex')<>b.build_digest THEN RAISE EXCEPTION 'OUTPUT_NOT_RETAINED';END IF;
  IF EXISTS(SELECT 1 FROM public.experience_build_files WHERE build_id=b.id AND merchant_id=p_merchant AND digest<>encode(sha256(bytes),'hex')) THEN RAISE EXCEPTION 'OUTPUT_NOT_RETAINED';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'assets') ref WHERE NOT EXISTS(SELECT 1 FROM public.experience_assets x WHERE x.merchant_id=p_merchant AND x.asset_id=ref->>'assetId' AND x.purpose='design' AND x.digest=encode(sha256(x.bytes),'hex'))) THEN RAISE EXCEPTION 'ASSET_NOT_RETAINED';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',asset_id,'digest',digest,'mime',mime) ORDER BY asset_id),'[]'::jsonb) INTO files FROM public.experience_assets x WHERE merchant_id=p_merchant AND EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'assets') ref WHERE ref->>'assetId'=x.asset_id);
  RETURN result||jsonb_build_object('readiness',builder_authorization.publication_missing_items(p_merchant),'build',b.id,'digest',b.build_digest,'runtime',b.host_origin,'manifest',manifest-'files','source',(SELECT source_digest FROM public.experience_jobs WHERE id=b.job_id),'assets',files);
 END IF;
 IF p_action NOT IN('draft-only','restore-legacy','unpublish-legacy-draft') THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 IF p_payload->>'targetLegacyRevision' IS DISTINCT FROM (SELECT token::text FROM public.builder_website_revisions WHERE merchant_id=p_merchant) THEN RAISE EXCEPTION 'STALE_LEGACY';END IF;
 IF p_action='restore-legacy' THEN SELECT jsonb_build_object('config',published_config,'seo',published_seo,'store',published_store_settings,'setup',published_setup_settings,'published',is_published) INTO legacy FROM public.page_configs WHERE merchant_id=p_merchant AND page_slug='home';
 ELSE SELECT jsonb_build_object('config',d.draft_config,'seo',d.draft_seo,'store',d.draft_store_settings,'setup',d.draft_setup_settings) INTO legacy FROM public.builder_page_drafts d JOIN public.page_configs p ON p.id=d.id WHERE d.merchant_id=p_merchant AND p.page_slug='home'; END IF;
 IF p_action='restore-legacy' AND (legacy#>>'{config,root,props,rendererVersion}' IS DISTINCT FROM 'baci-home-six-v1' OR legacy->>'published' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'COMPATIBLE_LEGACY_REQUIRED';END IF;
 RETURN result||jsonb_build_object('legacy',coalesce(legacy,jsonb_build_object('config',null,'unpublishedDraftOnly',true)),'template',(SELECT template_id FROM public.merchants WHERE id=p_merchant));
END $$;
REVOKE ALL ON FUNCTION experience_authorization.lifecycle_snapshot(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.experience_authorize_read(p_merchant uuid,p_connection uuid,p_version bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.experience_owner_readable(p_merchant) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p_connection IS NOT NULL THEN
  PERFORM 1 FROM builder_authorization.connections WHERE id=p_connection AND actor_user_id=auth.uid() AND status='active' AND revoked_at IS NULL AND expires_at>clock_timestamp() AND grant_version=p_version AND 'storefront.read'=ANY(scopes) AND p_merchant=ANY(allowed_merchant_ids) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_REVOKED';END IF;
 ELSIF p_version IS NOT NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.experience_authorize_read(uuid,uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_authorize_read(uuid,uuid,bigint) TO authenticated;
