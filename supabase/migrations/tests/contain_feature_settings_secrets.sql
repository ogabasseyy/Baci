-- Audit R2 regression: store users must not be able to SELECT ad-platform
-- secrets from public.merchant_feature_settings. Asserted through the catalog
-- (has_column_privilege / has_table_privilege / has_function_privilege) so
-- every grant path is covered: table-level grants, PUBLIC, and column grants.
BEGIN;

DO $$
DECLARE
  v_secret text;
  v_col text;
  v_secrets text[] := ARRAY[
    'facebook_capi_token','tiktok_access_token','snapchat_capi_token','ga4_api_secret'
  ];
  v_role text;
  v_count integer := 0;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['authenticated','anon'] LOOP
    IF has_table_privilege(v_role, 'public.merchant_feature_settings', 'SELECT') THEN
      RAISE EXCEPTION 'R2: % still has table-wide SELECT on merchant_feature_settings', v_role;
    END IF;
    FOREACH v_secret IN ARRAY v_secrets LOOP
      IF has_column_privilege(v_role, 'public.merchant_feature_settings', v_secret, 'SELECT') THEN
        RAISE EXCEPTION 'R2: % can SELECT secret column %', v_role, v_secret;
      END IF;
    END LOOP;
  END LOOP;

  -- The secret column list must cover every secret-looking column on the table.
  FOR v_col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'merchant_feature_settings'
      AND column_name ~ '(_token|_secret|_password|_api_key|_private_key)$'
      AND column_name <> ALL (v_secrets)
  LOOP
    RAISE EXCEPTION 'R2: unclassified secret-looking column % on merchant_feature_settings', v_col;
  END LOOP;

  -- Every non-secret column stays readable for authenticated (also forces a
  -- column GRANT whenever a later migration adds a column).
  FOR v_col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'merchant_feature_settings'
      AND column_name <> ALL (v_secrets)
  LOOP
    v_count := v_count + 1;
    IF NOT has_column_privilege('authenticated', 'public.merchant_feature_settings', v_col, 'SELECT') THEN
      RAISE EXCEPTION 'R2: authenticated lost SELECT on non-secret column %', v_col;
    END IF;
    IF has_column_privilege('anon', 'public.merchant_feature_settings', v_col, 'SELECT') THEN
      RAISE EXCEPTION 'R2: anon can SELECT column %', v_col;
    END IF;
  END LOOP;
  IF v_count < 50 THEN
    RAISE EXCEPTION 'R2: expected many readable columns, found %', v_count;
  END IF;

  -- Writes are unchanged so owners can still save a token.
  IF NOT (has_table_privilege('authenticated', 'public.merchant_feature_settings', 'INSERT')
      AND has_table_privilege('authenticated', 'public.merchant_feature_settings', 'UPDATE')) THEN
    RAISE EXCEPTION 'R2: authenticated lost INSERT/UPDATE on merchant_feature_settings';
  END IF;

  -- Server-side delivery path keeps access.
  FOREACH v_secret IN ARRAY v_secrets LOOP
    IF NOT has_column_privilege('service_role', 'public.merchant_feature_settings', v_secret, 'SELECT') THEN
      RAISE EXCEPTION 'R2: service_role lost SELECT on %', v_secret;
    END IF;
  END LOOP;

  -- Presence RPC: authenticated only.
  IF has_function_privilege('anon', 'public.get_merchant_integration_secret_presence(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.get_merchant_integration_secret_presence(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_merchant_integration_secret_presence(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R2: presence RPC grants are wrong';
  END IF;
END $$;

-- Behaviour: owner sees booleans only; a stranger gets NULL; direct read denied.
INSERT INTO auth.users (id, email)
VALUES ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'r2-owner@example.test');
-- Feature-settings changes are audited and the audit writer needs an actor.
SELECT set_config('app.audit_actor_user_id', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', true);
INSERT INTO public.merchants(id, user_id, email, business_name, slug)
VALUES ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
        'r2-owner@example.test', 'R2 Test Store', 'r2-test-store');
INSERT INTO public.merchant_feature_settings(merchant_id, facebook_capi_token, ga4_api_secret)
VALUES ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'synthetic-meta-token', '   ')
ON CONFLICT (merchant_id) DO UPDATE
  SET facebook_capi_token = EXCLUDED.facebook_capi_token,
      ga4_api_secret = EXCLUDED.ga4_api_secret;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
DECLARE v jsonb;
BEGIN
  v := public.get_merchant_integration_secret_presence('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
  IF v IS DISTINCT FROM jsonb_build_object(
    'facebook_capi_token', true, 'tiktok_access_token', false,
    'snapchat_capi_token', false, 'ga4_api_secret', false) THEN
    RAISE EXCEPTION 'R2: owner presence payload wrong: %', v;
  END IF;
  BEGIN
    PERFORM facebook_capi_token FROM public.merchant_feature_settings;
    RAISE EXCEPTION 'R2: secret column readable by owner session';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM merchant_id, blog_enabled FROM public.merchant_feature_settings;
END $$;

-- The dashboard context RPC (SECURITY DEFINER) must not hand the secrets back either.
DO $$
DECLARE v_ctx jsonb; v_fs jsonb;
BEGIN
  v_ctx := public.get_user_merchant_context();
  v_fs := v_ctx -> 'merchant' -> 'feature_settings';
  IF v_fs IS NULL THEN
    RAISE EXCEPTION 'R2: context RPC returned no feature_settings for the owner';
  END IF;
  IF v_fs ?| ARRAY['facebook_capi_token','tiktok_access_token','snapchat_capi_token','ga4_api_secret'] THEN
    RAISE EXCEPTION 'R2: context RPC still returns a secret key';
  END IF;
  IF pg_catalog.strpos(v_ctx::text, 'synthetic-meta-token') > 0 THEN
    RAISE EXCEPTION 'R2: context RPC leaks the token value';
  END IF;
  IF (v_fs ->> 'facebook_capi_token_configured')::boolean IS NOT TRUE
     OR (v_fs ->> 'ga4_api_secret_configured')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'R2: context RPC configured flags wrong: %', v_fs;
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', 'cccccccc-3333-4333-8333-cccccccccccc', true);
DO $$
BEGIN
  IF public.get_merchant_integration_secret_presence('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') IS NOT NULL THEN
    RAISE EXCEPTION 'R2: stranger received presence data';
  END IF;
END $$;
RESET ROLE;

SELECT 'contain_feature_settings_secrets_passed';
ROLLBACK;
