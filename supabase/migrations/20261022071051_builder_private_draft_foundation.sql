-- Additive private storage. Activate only with coordinated adapters and the
-- later guarded contract migration. No public draft column is removed here.
CREATE TABLE public.builder_page_drafts (
  id uuid PRIMARY KEY REFERENCES public.page_configs(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  draft_config jsonb,
  draft_seo jsonb,
  draft_store_settings jsonb,
  draft_setup_settings jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 1
);
CREATE INDEX builder_page_drafts_merchant_id_idx ON public.builder_page_drafts(merchant_id);
ALTER TABLE public.builder_page_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.builder_page_drafts FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_page_drafts TO authenticated;
CREATE POLICY builder_drafts_read ON public.builder_page_drafts FOR SELECT TO authenticated
USING (public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','view')
  OR public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','edit'));
CREATE POLICY builder_drafts_insert ON public.builder_page_drafts FOR INSERT TO authenticated
WITH CHECK ((public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','edit'))
  AND EXISTS (SELECT 1 FROM public.page_configs p WHERE p.id=builder_page_drafts.id AND p.merchant_id=builder_page_drafts.merchant_id));
CREATE POLICY builder_drafts_update ON public.builder_page_drafts FOR UPDATE TO authenticated
USING (public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','edit'))
WITH CHECK ((public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','edit'))
  AND EXISTS (SELECT 1 FROM public.page_configs p WHERE p.id=builder_page_drafts.id AND p.merchant_id=builder_page_drafts.merchant_id));
CREATE POLICY builder_drafts_delete ON public.builder_page_drafts FOR DELETE TO authenticated
USING (public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','edit'));

-- Direct RLS writers cannot keep or forge a stale CAS token. Identity is immutable.
CREATE FUNCTION public.builder_private_draft_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'Draft identity is immutable' USING ERRCODE='42501';
  END IF;
  NEW.updated_at := clock_timestamp();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.builder_private_draft_revision() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.builder_private_draft_revision() TO authenticated;
CREATE TRIGGER builder_private_draft_revision BEFORE UPDATE ON public.builder_page_drafts
FOR EACH ROW EXECUTE FUNCTION public.builder_private_draft_revision();

-- Global revision includes all pages and selected merchant identity/branding.
CREATE TABLE public.builder_website_revisions (
 merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
 token uuid NOT NULL DEFAULT gen_random_uuid(),
 last_txid bigint NOT NULL DEFAULT txid_current()
);
ALTER TABLE public.builder_website_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.builder_website_revisions FROM PUBLIC,anon,service_role;
GRANT SELECT,INSERT,UPDATE ON public.builder_website_revisions TO authenticated;
CREATE POLICY website_revision_read ON public.builder_website_revisions FOR SELECT TO authenticated
 USING(public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','view') OR public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','edit') OR public.check_staff_permission((SELECT auth.uid()),merchant_id,'settings','edit'));
CREATE POLICY website_revision_insert ON public.builder_website_revisions FOR INSERT TO authenticated WITH CHECK(public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','edit') OR public.check_staff_permission((SELECT auth.uid()),merchant_id,'settings','edit'));
CREATE POLICY website_revision_update ON public.builder_website_revisions FOR UPDATE TO authenticated USING(public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','edit') OR public.check_staff_permission((SELECT auth.uid()),merchant_id,'settings','edit')) WITH CHECK(public.check_staff_permission((SELECT auth.uid()),merchant_id,'builder','edit') OR public.check_staff_permission((SELECT auth.uid()),merchant_id,'settings','edit'));
CREATE FUNCTION public.builder_website_guard(p_merchant_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('baci.website:'||p_merchant_id::text,0)) THEN
  RAISE EXCEPTION 'website_busy' USING ERRCODE='40001';
 END IF;
END $$;
CREATE FUNCTION public.builder_revision_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.builder_website_guard(NEW.merchant_id);
 IF TG_OP='INSERT' THEN NEW.token:=gen_random_uuid();
 ELSE
  IF NEW.merchant_id<>OLD.merchant_id THEN RAISE EXCEPTION 'immutable_revision_identity'; END IF;
  NEW.token:=CASE WHEN OLD.last_txid=txid_current() THEN OLD.token ELSE gen_random_uuid() END;
 END IF;
 NEW.last_txid:=txid_current();RETURN NEW;
END $$;
CREATE TRIGGER builder_revision_stamp BEFORE INSERT OR UPDATE ON public.builder_website_revisions FOR EACH ROW EXECUTE FUNCTION public.builder_revision_stamp();
CREATE FUNCTION public.builder_observe_website() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='merchants' THEN
  target:=NEW.id;
 ELSE
  IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN RAISE EXCEPTION 'immutable_page_identity' USING ERRCODE='42501'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN target:=OLD.merchant_id; ELSE target:=NEW.merchant_id; END IF;
 END IF;
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=target) THEN RETURN OLD; END IF;
 PERFORM public.builder_website_guard(target);
 -- Unchanged writes do not invalidate a revision.
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'updated_at'-'version') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'version') THEN RETURN NEW; END IF;
 INSERT INTO public.builder_website_revisions(merchant_id) VALUES(target)
 ON CONFLICT(merchant_id) DO UPDATE SET last_txid=txid_current();
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
CREATE TRIGGER builder_observe_pages BEFORE INSERT OR UPDATE OR DELETE ON public.page_configs FOR EACH ROW EXECUTE FUNCTION public.builder_observe_website();
CREATE TRIGGER builder_observe_private BEFORE INSERT OR UPDATE OR DELETE ON public.builder_page_drafts FOR EACH ROW EXECUTE FUNCTION public.builder_observe_website();
CREATE TRIGGER builder_observe_identity AFTER UPDATE OF business_name,brand_colors,logo_url,hero_image_ids,payout_currency,template_id,slug,pages,site_title,site_tagline,site_description ON public.merchants FOR EACH ROW EXECUTE FUNCTION public.builder_observe_website();
REVOKE ALL ON FUNCTION public.builder_website_guard(uuid),public.builder_revision_stamp(),public.builder_observe_website() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_website_guard(uuid),public.builder_revision_stamp(),public.builder_observe_website() TO authenticated;
