-- This rehearsal commits a schema contraction. Run only through the owned
-- chronological replay with an empty synthetic merchant database.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.merchants) THEN
    RAISE EXCEPTION 'cutover rehearsal requires an empty synthetic database';
  END IF;
END $$;
-- Seed fixtures without external welcome or storefront hooks. Re-enable ordinary
-- triggers before testing the cutover and all authenticated paths.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('fa420300-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@example.invalid', '{}', '{}'),
  ('fa420300-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'staff@example.invalid', '{}', '{}'),
  ('fa420300-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'stranger@example.invalid', '{}', '{}');
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('fa420300-0000-4000-8000-000000000010', 'fa420300-0000-4000-8000-000000000001',
  'owner@example.invalid', 'Synthetic cutover merchant', 'synthetic-cutover-recovery', true);
INSERT INTO public.staff_members (merchant_id, user_id, email, name, role, permissions, status)
VALUES ('fa420300-0000-4000-8000-000000000010', 'fa420300-0000-4000-8000-000000000002',
  'staff@example.invalid', 'Synthetic builder staff', 'accountant', '{"builder":{"view":true,"edit":true}}', 'active');
INSERT INTO public.page_configs (merchant_id, page_slug, page_name, draft_config, published_config, is_published)
VALUES ('fa420300-0000-4000-8000-000000000010', 'home', 'Home',
  '{"fixture":"legacy draft"}', '{"fixture":"existing public page"}', true);
INSERT INTO public.ai_jobs (id, merchant_id, type, status, input)
VALUES ('fa420300-0000-4000-8000-000000000020', 'fa420300-0000-4000-8000-000000000010',
  'storefront_layout_generation', 'processing', '{}');
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claims','{"sub":"fa420300-0000-4000-8000-000000000001","role":"authenticated"}',true);

SET LOCAL baci.builder_private_cutover = 'approved';
DO $$
BEGIN
  BEGIN
    CALL builder_authorization.cutover_private_drafts();
    RAISE EXCEPTION 'expected active old-worker drain to block contraction';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'builder_private_cutover_requires_legacy_job_drain' THEN
      RAISE;
    END IF;
  END;
END $$;
-- Simulated stop of the legacy worker. No generation provider is called.
UPDATE public.ai_jobs SET status = 'failed' WHERE id = 'fa420300-0000-4000-8000-000000000020';
CALL builder_authorization.cutover_private_drafts();
COMMIT;

-- A fresh database session models switching to the compatible native path.
\connect -reuse-previous=on :DBNAME
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.page_configs'::regclass AND NOT attisdropped
      AND attname IN ('draft_config','draft_seo','draft_store_settings','draft_setup_settings')
  ) THEN
    RAISE EXCEPTION 'contraction did not survive reconnect';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa420300-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE
  merchant constant uuid := 'fa420300-0000-4000-8000-000000000010';
  draft jsonb := public.builder_private_load(merchant, 'home');
  saved jsonb;
BEGIN
  IF draft->'draft_config' IS DISTINCT FROM '{"fixture":"legacy draft"}'::jsonb THEN
    RAISE EXCEPTION 'owner did not recover the migrated draft';
  END IF;
  saved := public.builder_private_save(merchant,'home','Home','{"fixture":"recovered edit"}',NULL,NULL,NULL,
    (draft->>'updated_at')::timestamptz);
  IF saved->>'id' IS NULL THEN
    RAISE EXCEPTION 'owner save failed after contracting legacy columns';
  END IF;
  IF (public.builder_private_enqueue(merchant,'home','{}'))->>'status' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'native job enqueue failed after contraction';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"fa420300-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
DECLARE
  merchant constant uuid := 'fa420300-0000-4000-8000-000000000010';
  draft jsonb := public.builder_private_load(merchant, 'home');
BEGIN
  IF draft->'draft_config' IS DISTINCT FROM '{"fixture":"recovered edit"}'::jsonb THEN
    RAISE EXCEPTION 'staff did not see the owner edit';
  END IF;
  IF (public.builder_private_save(merchant,'home','Home','{"fixture":"staff recovery edit"}',NULL,NULL,NULL,
      (draft->>'updated_at')::timestamptz))->>'id' IS NULL THEN
    RAISE EXCEPTION 'staff save failed after contraction';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"fa420300-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$
BEGIN
  IF public.builder_private_load('fa420300-0000-4000-8000-000000000010', 'home') IS NOT NULL THEN
    RAISE EXCEPTION 'foreign actor read a migrated draft';
  END IF;
END $$;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF (SELECT published_config FROM public.page_configs
      WHERE merchant_id = 'fa420300-0000-4000-8000-000000000010' AND page_slug = 'home')
      IS DISTINCT FROM '{"fixture":"existing public page"}'::jsonb THEN
    RAISE EXCEPTION 'existing public page went unavailable';
  END IF;
  IF pg_catalog.has_table_privilege(current_user, 'public.builder_page_drafts', 'SELECT') THEN
    RAISE EXCEPTION 'anonymous role acquired private draft access';
  END IF;
END $$;
COMMIT;

-- Reopen in a different session after the recovery edits committed. A seeded
-- completion exercises native application without any generation-provider call.
\connect -reuse-previous=on :DBNAME
BEGIN;
UPDATE public.ai_jobs SET status = 'completed'
WHERE merchant_id = 'fa420300-0000-4000-8000-000000000010'
  AND type = 'storefront_layout_generation' AND status = 'pending';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"fa420300-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE
  merchant constant uuid := 'fa420300-0000-4000-8000-000000000010';
  draft jsonb := public.builder_private_load(merchant, 'home');
  job_id uuid;
  applied_now boolean;
BEGIN
  IF draft->'draft_config' IS DISTINCT FROM '{"fixture":"staff recovery edit"}'::jsonb THEN
    RAISE EXCEPTION 'post-cutover edits did not survive reconnect';
  END IF;
  SELECT id INTO STRICT job_id FROM public.ai_jobs
  WHERE merchant_id = merchant AND type = 'storefront_layout_generation' AND status = 'completed';
  SELECT applied INTO applied_now FROM public.apply_ai_storefront_draft(
    job_id, merchant, 'home', '{"fixture":"synthetic completed layout"}',
    (draft->>'updated_at')::timestamptz, false
  );
  IF applied_now IS DISTINCT FROM true OR
    (public.builder_private_load(merchant, 'home'))->'draft_config'
      IS DISTINCT FROM '{"fixture":"synthetic completed layout"}'::jsonb THEN
    RAISE EXCEPTION 'native result apply failed on private storage';
  END IF;
END $$;
COMMIT;
