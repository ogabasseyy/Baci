-- Catalog freshness is independent of caches and all writer entry points.
CREATE OR REPLACE FUNCTION experience_authorization.bump_catalog_generation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_merchant uuid; new_merchant uuid; parent_id uuid;
BEGIN
 IF TG_TABLE_NAME='merchants' THEN
  IF TG_OP='UPDATE' AND
    (to_jsonb(OLD)->'payout_currency',to_jsonb(OLD)->'currency',to_jsonb(OLD)->'is_published',to_jsonb(OLD)->'premium_features',to_jsonb(OLD)->'shared_cart_enabled',to_jsonb(OLD)->'shared_cart_accounts_enabled',to_jsonb(OLD)->'feature_settings',to_jsonb(OLD)->'plan_tier',to_jsonb(OLD)->'plan_expires_at') IS NOT DISTINCT FROM
    (to_jsonb(NEW)->'payout_currency',to_jsonb(NEW)->'currency',to_jsonb(NEW)->'is_published',to_jsonb(NEW)->'premium_features',to_jsonb(NEW)->'shared_cart_enabled',to_jsonb(NEW)->'shared_cart_accounts_enabled',to_jsonb(NEW)->'feature_settings',to_jsonb(NEW)->'plan_tier',to_jsonb(NEW)->'plan_expires_at') THEN RETURN NEW; END IF;
  new_merchant:=NEW.id;
 ELSIF TG_TABLE_NAME IN ('products','categories','branches') THEN
  IF TG_OP<>'INSERT' THEN old_merchant:=OLD.merchant_id; END IF;
  IF TG_OP<>'DELETE' THEN new_merchant:=NEW.merchant_id; END IF;
 ELSIF TG_TABLE_NAME='variant_inventory' THEN
  IF TG_OP<>'INSERT' THEN SELECT p.merchant_id INTO old_merchant FROM public.product_variants v JOIN public.products p ON p.id=v.product_id WHERE v.id=OLD.variant_id; END IF;
  IF TG_OP<>'DELETE' THEN SELECT p.merchant_id INTO new_merchant FROM public.product_variants v JOIN public.products p ON p.id=v.product_id WHERE v.id=NEW.variant_id; END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN
   SELECT merchant_id INTO old_merchant FROM public.products WHERE id=OLD.product_id;
  END IF;
  IF TG_OP<>'DELETE' THEN
   SELECT merchant_id INTO new_merchant FROM public.products WHERE id=NEW.product_id;
  END IF;
 END IF;
 -- Product BEFORE DELETE bumps its own merchant before child cascade deletes;
 -- no child writer can nominate a different merchant to invalidate.
 IF old_merchant IS NOT NULL AND EXISTS(SELECT 1 FROM public.merchants WHERE id=old_merchant) THEN
  INSERT INTO public.experience_catalog_generations(merchant_id,generation) VALUES(old_merchant,1)
  ON CONFLICT(merchant_id) DO UPDATE SET generation=public.experience_catalog_generations.generation+1;
 END IF;
 IF new_merchant IS NOT NULL AND new_merchant IS DISTINCT FROM old_merchant AND EXISTS(SELECT 1 FROM public.merchants WHERE id=new_merchant) THEN
  INSERT INTO public.experience_catalog_generations(merchant_id,generation) VALUES(new_merchant,1)
  ON CONFLICT(merchant_id) DO UPDATE SET generation=public.experience_catalog_generations.generation+1;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;$$;
REVOKE ALL ON FUNCTION experience_authorization.bump_catalog_generation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER experience_products_generation BEFORE INSERT OR UPDATE OR DELETE ON public.products FOR EACH ROW EXECUTE FUNCTION experience_authorization.bump_catalog_generation();
CREATE TRIGGER experience_variants_generation BEFORE INSERT OR UPDATE OR DELETE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION experience_authorization.bump_catalog_generation();
CREATE TRIGGER experience_offers_generation BEFORE INSERT OR UPDATE OR DELETE ON public.product_offers FOR EACH ROW EXECUTE FUNCTION experience_authorization.bump_catalog_generation();
CREATE TRIGGER experience_categories_generation BEFORE INSERT OR UPDATE OR DELETE ON public.categories FOR EACH ROW EXECUTE FUNCTION experience_authorization.bump_catalog_generation();
CREATE TRIGGER experience_merchants_generation AFTER INSERT OR UPDATE ON public.merchants FOR EACH ROW EXECUTE FUNCTION experience_authorization.bump_catalog_generation();
INSERT INTO public.experience_catalog_generations(merchant_id) SELECT id FROM public.merchants ON CONFLICT DO NOTHING;
GRANT SELECT(merchant_id,generation) ON public.experience_catalog_generations TO anon,authenticated;
CREATE POLICY published_generation_read ON public.experience_catalog_generations FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.is_published IS TRUE));

CREATE TRIGGER experience_membership_generation BEFORE INSERT OR UPDATE OR DELETE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION experience_authorization.bump_catalog_generation();
CREATE TRIGGER experience_inventory_generation BEFORE INSERT OR UPDATE OR DELETE ON public.variant_inventory FOR EACH ROW EXECUTE FUNCTION experience_authorization.bump_catalog_generation();
CREATE TRIGGER experience_branches_generation BEFORE INSERT OR UPDATE OR DELETE ON public.branches FOR EACH ROW EXECUTE FUNCTION experience_authorization.bump_catalog_generation();
