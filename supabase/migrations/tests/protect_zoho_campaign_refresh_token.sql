-- Follow-up to audit R2: the Zoho Campaigns refresh token must not be readable
-- by store staff. It moved out of merchant_feature_settings.custom_settings
-- into merchant_zoho_campaign_credentials, which no signed-in role can query.
BEGIN;

DO $$
DECLARE
  v_role text;
  v_priv text;
  v_fn text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES'] LOOP
      IF has_table_privilege(v_role, 'public.merchant_zoho_campaign_credentials', v_priv) THEN
        RAISE EXCEPTION 'Zoho: % has % on merchant_zoho_campaign_credentials', v_role, v_priv;
      END IF;
    END LOOP;
    IF has_column_privilege(v_role, 'public.merchant_zoho_campaign_credentials', 'refresh_token', 'SELECT') THEN
      RAISE EXCEPTION 'Zoho: % can SELECT refresh_token', v_role;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.merchant_zoho_campaign_credentials', 'SELECT') THEN
    RAISE EXCEPTION 'Zoho: service_role lost access to the credentials table';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.merchant_zoho_campaign_credentials'::regclass) THEN
    RAISE EXCEPTION 'Zoho: RLS is off on the credentials table';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'merchant_zoho_campaign_credentials') THEN
    RAISE EXCEPTION 'Zoho: unexpected policy on the credentials table';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_merchant_zoho_refresh_token(uuid)',
    'public.set_merchant_zoho_refresh_token(uuid,text)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('public', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Zoho: wrong grants on %', v_fn;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.get_merchant_zoho_refresh_token(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Zoho: service_role cannot read the token for server sends';
  END IF;
END $$;

INSERT INTO public.merchants(id, user_id, email, business_name, slug)
VALUES ('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', 'bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb',
        'zoho-owner@example.test', 'Zoho Test Store', 'zoho-test-store');
INSERT INTO public.merchant_feature_settings(merchant_id)
VALUES ('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa')
ON CONFLICT (merchant_id) DO NOTHING;

-- custom_settings can no longer hold token keys (either spelling).
DO $$
BEGIN
  BEGIN
    UPDATE public.merchant_feature_settings
    SET custom_settings = '{"zohoCampaigns":{"enabled":true,"refreshToken":"synthetic"}}'::jsonb
    WHERE merchant_id = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
    RAISE EXCEPTION 'Zoho: token key accepted in custom_settings';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.merchant_feature_settings
    SET custom_settings = '{"zoho_campaigns":{"client_secret":"synthetic"}}'::jsonb
    WHERE merchant_id = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
    RAISE EXCEPTION 'Zoho: snake_case secret accepted in custom_settings';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.merchant_feature_settings
  SET custom_settings = '{"zohoCampaigns":{"enabled":true,"listKey":"L1"}}'::jsonb
  WHERE merchant_id = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
END $$;

-- Owner can set and read; stranger gets nothing and cannot write.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT public.set_merchant_zoho_refresh_token('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', '  synthetic-refresh  ');
DO $$
BEGIN
  IF public.get_merchant_zoho_refresh_token('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa') IS DISTINCT FROM 'synthetic-refresh' THEN
    RAISE EXCEPTION 'Zoho: owner could not read the saved token';
  END IF;
  BEGIN
    PERFORM refresh_token FROM public.merchant_zoho_campaign_credentials;
    RAISE EXCEPTION 'Zoho: owner session read the credentials table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub', 'cccccccc-7777-4777-8777-cccccccccccc', true);
DO $$
BEGIN
  IF public.get_merchant_zoho_refresh_token('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa') IS NOT NULL THEN
    RAISE EXCEPTION 'Zoho: stranger read the token';
  END IF;
  BEGIN
    PERFORM public.set_merchant_zoho_refresh_token('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', 'attacker');
    RAISE EXCEPTION 'Zoho: stranger replaced the token';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Server role (campaign send / cron) can read it.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$
BEGIN
  IF public.get_merchant_zoho_refresh_token('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa') IS DISTINCT FROM 'synthetic-refresh' THEN
    RAISE EXCEPTION 'Zoho: server role could not read the token';
  END IF;
END $$;
RESET ROLE;

-- Blank value clears it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT public.set_merchant_zoho_refresh_token('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', '   ');
DO $$
BEGIN
  IF public.get_merchant_zoho_refresh_token('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa') IS NOT NULL THEN
    RAISE EXCEPTION 'Zoho: blank did not clear the token';
  END IF;
END $$;
RESET ROLE;

SELECT 'protect_zoho_campaign_refresh_token_passed';
ROLLBACK;
