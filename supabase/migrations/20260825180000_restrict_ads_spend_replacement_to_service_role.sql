BEGIN;

REVOKE ALL ON FUNCTION public.replace_google_ads_spend_daily(
  uuid, text, date, date, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_google_ads_spend_daily(
  uuid, text, date, date, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.replace_merchant_ads_spend_daily_window(
  uuid, text, text, date, date, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_merchant_ads_spend_daily_window(
  uuid, text, text, date, date, jsonb
) TO service_role;

COMMIT;
