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

-- Run the migration's real backfill functions. PostgreSQL reads E'\v' as the letter v, so a
-- token that starts or ends with v must survive; whitespace-only candidates must fall through
-- to a valid fallback; and every token key must be gone from the cleaned settings.
DO $$
DECLARE v_clean jsonb;
BEGIN
  IF private.zoho_refresh_token_from_custom_settings_v1(
       '{"zohoCampaigns":{"refreshToken":"vABCv"}}'::jsonb) IS DISTINCT FROM 'vABCv' THEN
    RAISE EXCEPTION 'Zoho: backfill corrupts a token that starts or ends with v';
  END IF;
  IF private.zoho_refresh_token_from_custom_settings_v1(
       jsonb_build_object('zohoCampaigns', jsonb_build_object(
         'refreshToken', E' \t ', 'refresh_token', E'\t padded-v \n'))) IS DISTINCT FROM 'padded-v' THEN
    RAISE EXCEPTION 'Zoho: backfill does not fall back from a blank token or trim padding';
  END IF;
  IF private.zoho_refresh_token_from_custom_settings_v1(
       '{"zohoCampaigns":{"refreshToken":7},"zoho_campaigns":{"refresh_token":"snake-ok"}}'::jsonb)
       IS DISTINCT FROM 'snake-ok' THEN
    RAISE EXCEPTION 'Zoho: backfill does not ignore non-string tokens';
  END IF;
  IF private.zoho_refresh_token_from_custom_settings_v1(
       '{"zohoCampaigns":{"refreshToken":"   "}}'::jsonb) IS NOT NULL THEN
    RAISE EXCEPTION 'Zoho: a whitespace-only token must not be backfilled';
  END IF;

  v_clean := private.strip_zoho_secrets_from_custom_settings_v1(
    '{"zohoCampaigns":{"enabled":true,"listKey":"L","refreshToken":"a","accessToken":"b","clientSecret":"c"},
      "zoho_campaigns":{"refresh_token":"d","access_token":"e","client_secret":"f"},"other":1}'::jsonb);
  IF COALESCE((v_clean -> 'zohoCampaigns') ?| ARRAY[
       'accessToken', 'access_token', 'clientSecret', 'client_secret', 'refreshToken', 'refresh_token'], false)
     OR COALESCE((v_clean -> 'zoho_campaigns') ?| ARRAY[
       'accessToken', 'access_token', 'clientSecret', 'client_secret', 'refreshToken', 'refresh_token'], false) THEN
    RAISE EXCEPTION 'Zoho: cleanup left a token key behind: %', v_clean;
  END IF;
  IF v_clean -> 'zohoCampaigns' IS DISTINCT FROM '{"enabled":true,"listKey":"L"}'::jsonb
     OR (v_clean ->> 'other') IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Zoho: cleanup removed non-secret settings: %', v_clean;
  END IF;
END $$;

INSERT INTO auth.users (id, email)
VALUES ('bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb', 'zoho-owner@example.test');
-- Feature-settings changes are audited and the audit writer needs an actor.
SELECT set_config('app.audit_actor_user_id', 'bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb', true);
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

-- End to end: seed a legacy row (token inside custom_settings), run the migration's real
-- backfill function, and check the saved token and the cleaned settings. The CHECK is
-- dropped only inside this rolled-back transaction so the legacy row can exist.
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
ALTER TABLE public.merchant_feature_settings
  DROP CONSTRAINT merchant_feature_settings_no_zoho_secrets;
INSERT INTO auth.users (id, email)
VALUES ('bbbbbbbb-8888-4888-8888-bbbbbbbbbbbb', 'zoho-legacy@example.test');
INSERT INTO public.merchants(id, user_id, email, business_name, slug)
VALUES ('aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa', 'bbbbbbbb-8888-4888-8888-bbbbbbbbbbbb',
        'zoho-legacy@example.test', 'Zoho Legacy Store', 'zoho-legacy-store');
INSERT INTO public.merchant_feature_settings(merchant_id, custom_settings)
VALUES ('aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa',
  jsonb_build_object('zohoCampaigns', jsonb_build_object(
    'enabled', true, 'listKey', 'L9', 'refreshToken', E' \t ',
    'refresh_token', 'vLegacyv', 'accessToken', 'short-lived')))
ON CONFLICT (merchant_id) DO UPDATE SET custom_settings = EXCLUDED.custom_settings;
SELECT private.backfill_zoho_campaign_credentials_v1();
DO $$
BEGIN
  IF (SELECT refresh_token FROM public.merchant_zoho_campaign_credentials
      WHERE merchant_id = 'aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa') IS DISTINCT FROM 'vLegacyv' THEN
    RAISE EXCEPTION 'Zoho: backfill did not save the legacy token';
  END IF;
  IF (SELECT custom_settings FROM public.merchant_feature_settings
      WHERE merchant_id = 'aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa')
     IS DISTINCT FROM '{"zohoCampaigns":{"enabled":true,"listKey":"L9"}}'::jsonb THEN
    RAISE EXCEPTION 'Zoho: backfill did not clean the legacy settings';
  END IF;
END $$;

-- Token changes leave canonical audit events that carry presence only, never the token.
DO $$
DECLARE v_actions text[]; v_text text;
BEGIN
  SELECT pg_catalog.array_agg(e.action ORDER BY e.occurred_at, e.action),
         pg_catalog.string_agg(pg_catalog.concat_ws(' ', e.before_values::text, e.after_values::text, e.metadata::text), ' ')
    INTO v_actions, v_text
  FROM public.audit_events AS e
  WHERE e.merchant_id = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'
    AND e.resource_type = 'merchant_zoho_credential';
  IF v_actions IS DISTINCT FROM ARRAY['merchant.zoho_credential.configure', 'merchant.zoho_credential.clear'] THEN
    RAISE EXCEPTION 'Zoho: expected configure then clear audit events, got %', v_actions;
  END IF;
  IF pg_catalog.strpos(v_text, 'synthetic-refresh') > 0 THEN
    RAISE EXCEPTION 'Zoho: audit event leaks the token value';
  END IF;
END $$;

SELECT 'protect_zoho_campaign_refresh_token_passed';
ROLLBACK;
