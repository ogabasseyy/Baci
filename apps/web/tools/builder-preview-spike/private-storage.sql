-- Additive Task 0 storage foundation. No reader is switched and no public
-- draft column is removed here. The disposable cutover is private-split.sql.
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
