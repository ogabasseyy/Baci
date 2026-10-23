-- Internal revision bookkeeping only: authorized table writes retain their own
-- caller/RLS checks. No application role gains raw revision or private-draft access.
-- Origin guards prevent the definer from being repurposed on caller-owned tables.
CREATE OR REPLACE FUNCTION public.builder_observe_website() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_LEVEL<>'ROW' OR TG_RELID NOT IN('public.merchants'::regclass,'public.page_configs'::regclass,'public.builder_page_drafts'::regclass) THEN RAISE EXCEPTION 'invalid_revision_trigger_origin' USING ERRCODE='42501';END IF;
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

CREATE OR REPLACE FUNCTION public.builder_observe_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid; old_public jsonb; new_public jsonb;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_LEVEL<>'ROW' OR TG_RELID NOT IN('public.merchants'::regclass,'public.page_configs'::regclass) THEN RAISE EXCEPTION 'invalid_revision_trigger_origin' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='merchants' THEN
  target:=NEW.id;
  old_public:=jsonb_build_array(OLD.is_published,OLD.business_name,OLD.slug,OLD.template_id,OLD.brand_colors,OLD.logo_url,OLD.hero_image_ids,OLD.payout_currency,OLD.pages,OLD.site_title,OLD.site_tagline,OLD.site_description);
  new_public:=jsonb_build_array(NEW.is_published,NEW.business_name,NEW.slug,NEW.template_id,NEW.brand_colors,NEW.logo_url,NEW.hero_image_ids,NEW.payout_currency,NEW.pages,NEW.site_title,NEW.site_tagline,NEW.site_description);
 ELSE
  target:=CASE WHEN TG_OP='DELETE' THEN OLD.merchant_id ELSE NEW.merchant_id END;
  IF TG_OP<>'INSERT' THEN old_public:=jsonb_build_array(OLD.published_config,OLD.published_seo,OLD.published_store_settings,OLD.published_setup_settings,OLD.is_published);END IF;
  IF TG_OP<>'DELETE' THEN new_public:=jsonb_build_array(NEW.published_config,NEW.published_seo,NEW.published_store_settings,NEW.published_setup_settings,NEW.is_published);END IF;
  IF TG_OP='INSERT' AND NEW.published_config IS NULL AND NOT coalesce(NEW.is_published,false) THEN RETURN NEW;END IF;
  IF TG_OP='DELETE' AND OLD.published_config IS NULL AND NOT coalesce(OLD.is_published,false) THEN RETURN OLD;END IF;
 END IF;
 IF old_public IS NOT DISTINCT FROM new_public THEN RETURN NEW;END IF;
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=target) THEN RETURN OLD;END IF;
 PERFORM public.builder_website_guard(target);
 INSERT INTO public.builder_published_revisions(merchant_id) VALUES(target) ON CONFLICT(merchant_id) DO UPDATE SET last_txid=txid_current();
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
ALTER FUNCTION public.builder_observe_website() OWNER TO postgres;
ALTER FUNCTION public.builder_observe_publication() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.builder_observe_website(),public.builder_observe_publication() FROM PUBLIC,anon,authenticated,service_role;
