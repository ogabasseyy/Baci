-- Additive, inactive until coordinated private-draft release. Public revisions are
-- maintained by all database writers, independently of ChatGPT receipts.
CREATE TABLE public.builder_published_revisions (
 merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
 token uuid NOT NULL DEFAULT gen_random_uuid(), last_txid bigint NOT NULL DEFAULT txid_current()
);
ALTER TABLE public.builder_published_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY published_revision_owner ON public.builder_published_revisions TO authenticated
 USING(public.check_staff_permission(auth.uid(),merchant_id,'builder','view') OR public.check_staff_permission(auth.uid(),merchant_id,'builder','edit') OR public.check_staff_permission(auth.uid(),merchant_id,'settings','edit'))
 WITH CHECK(public.check_staff_permission(auth.uid(),merchant_id,'builder','edit') OR public.check_staff_permission(auth.uid(),merchant_id,'settings','edit'));
CREATE POLICY published_revision_public ON public.builder_published_revisions FOR SELECT TO anon,authenticated
 USING(EXISTS(SELECT 1 FROM public.merchants m JOIN public.page_configs p ON p.merchant_id=m.id AND p.page_slug='home' WHERE m.id=builder_published_revisions.merchant_id AND m.is_published AND p.is_published AND p.published_config IS NOT NULL));
REVOKE ALL ON public.builder_published_revisions FROM PUBLIC,anon,service_role;
GRANT SELECT ON public.builder_published_revisions TO anon;
GRANT SELECT,INSERT,UPDATE ON public.builder_published_revisions TO authenticated;
INSERT INTO public.builder_published_revisions(merchant_id) SELECT DISTINCT merchant_id FROM public.page_configs;
CREATE FUNCTION public.builder_stamp_public_revision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.merchant_id<>OLD.merchant_id THEN RAISE EXCEPTION 'immutable_revision_identity'; END IF;
 NEW.token:=CASE WHEN TG_OP='UPDATE' AND OLD.last_txid=txid_current() THEN OLD.token ELSE gen_random_uuid() END;
 NEW.last_txid:=txid_current();RETURN NEW;
END $$;
CREATE TRIGGER builder_stamp_public_revision BEFORE INSERT OR UPDATE ON public.builder_published_revisions FOR EACH ROW EXECUTE FUNCTION public.builder_stamp_public_revision();
CREATE FUNCTION public.builder_observe_publication() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target uuid; old_public jsonb; new_public jsonb;
BEGIN
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
CREATE TRIGGER builder_observe_public_pages AFTER INSERT OR UPDATE OR DELETE ON public.page_configs FOR EACH ROW EXECUTE FUNCTION public.builder_observe_publication();
CREATE TRIGGER builder_observe_public_merchant AFTER UPDATE OF is_published,business_name,slug,template_id,brand_colors,logo_url,hero_image_ids,payout_currency,pages,site_title,site_tagline,site_description ON public.merchants FOR EACH ROW EXECUTE FUNCTION public.builder_observe_publication();
-- A single statement binds the published config to its exact public revision.
CREATE FUNCTION public.builder_public_home(p_merchant uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('config',p.published_config,'publishedVersion','published:'||v.token)
 FROM public.page_configs p JOIN public.merchants m ON m.id=p.merchant_id JOIN public.builder_published_revisions v ON v.merchant_id=p.merchant_id
 WHERE p.merchant_id=p_merchant AND p.page_slug='home' AND p.is_published AND m.is_published AND p.published_config IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.builder_stamp_public_revision(),public.builder_observe_publication(),public.builder_public_home(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_stamp_public_revision(),public.builder_observe_publication() TO authenticated;
GRANT EXECUTE ON FUNCTION public.builder_public_home(uuid) TO anon,authenticated;
-- Every readiness writer uses the same nonblocking website guard. This avoids
-- stale readiness without granting raw verification/payment columns to callers.
CREATE FUNCTION public.builder_guard_launch_facts() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='merchants' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE target:=CASE WHEN TG_OP='DELETE' THEN OLD.merchant_id ELSE NEW.merchant_id END;END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('baci.website:'||target::text,0)) THEN RAISE EXCEPTION 'website_busy' USING ERRCODE='40001';END IF;
 IF TG_TABLE_NAME<>'merchants' THEN
 IF TG_OP='UPDATE' AND OLD.merchant_id IS DISTINCT FROM NEW.merchant_id THEN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('baci.website:'||OLD.merchant_id::text,0)) THEN RAISE EXCEPTION 'website_busy' USING ERRCODE='40001';END IF;
 END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER builder_guard_launch_products BEFORE INSERT OR UPDATE OR DELETE ON public.products FOR EACH ROW EXECUTE FUNCTION public.builder_guard_launch_facts();
CREATE TRIGGER builder_guard_launch_features BEFORE INSERT OR UPDATE OR DELETE ON public.merchant_feature_settings FOR EACH ROW EXECUTE FUNCTION public.builder_guard_launch_facts();
CREATE TRIGGER builder_guard_launch_verification BEFORE INSERT OR UPDATE OR DELETE ON public.merchant_verifications FOR EACH ROW EXECUTE FUNCTION public.builder_guard_launch_facts();
CREATE TRIGGER builder_guard_launch_merchant BEFORE UPDATE OF user_id,slug,country,payout_currency,email,phone,support_email,support_phone,bank_code,bank_account_number,paystack_subaccount_code ON public.merchants FOR EACH ROW EXECUTE FUNCTION public.builder_guard_launch_facts();
REVOKE ALL ON FUNCTION public.builder_guard_launch_facts() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_guard_launch_facts() TO authenticated;
