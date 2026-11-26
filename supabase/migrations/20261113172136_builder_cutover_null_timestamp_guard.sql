-- A missing legacy revision cannot establish which differing draft is newer.
-- Keep the original lock order and operator-only invoker boundary.
CREATE OR REPLACE PROCEDURE builder_authorization.cutover_private_drafts()
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.page_configs'::regclass
      AND attname = 'draft_config' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'builder_private_cutover_already_applied';
  END IF;
  IF current_setting('baci.builder_private_cutover', true) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'builder_private_cutover_requires_coordinated_release';
  END IF;
  LOCK TABLE public.ai_jobs IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1 FROM public.ai_jobs
    WHERE type = 'storefront_layout_generation'
      AND status IN ('pending', 'running', 'processing')
  ) THEN
    RAISE EXCEPTION 'builder_private_cutover_requires_legacy_job_drain';
  END IF;
  LOCK TABLE public.page_configs IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.builder_page_drafts IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1
    FROM public.page_configs AS legacy
    JOIN public.builder_page_drafts AS private ON private.id = legacy.id
    WHERE private.merchant_id IS DISTINCT FROM legacy.merchant_id
       OR (
         (legacy.updated_at IS NULL OR private.updated_at = legacy.updated_at)
         AND (legacy.draft_config, legacy.draft_seo, legacy.draft_store_settings, legacy.draft_setup_settings)
             IS DISTINCT FROM
             (private.draft_config, private.draft_seo, private.draft_store_settings, private.draft_setup_settings)
       )
  ) THEN
    RAISE EXCEPTION 'builder_private_draft_reconciliation_conflict';
  END IF;
  CALL builder_authorization.cutover_private_drafts_unchecked_20261113();
END;
$$;

REVOKE ALL ON PROCEDURE builder_authorization.cutover_private_drafts()
  FROM PUBLIC, anon, authenticated, service_role, baci_builder_auth_storage;
