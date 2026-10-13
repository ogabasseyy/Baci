BEGIN;

-- Replacement-window functions remain the only externally callable Ads spend
-- writers. Their SECURITY DEFINER owner may call this validated helper, while
-- PostgREST roles (including service_role) cannot bypass window replacement.
REVOKE ALL ON FUNCTION public.upsert_merchant_ads_spend_daily(
  uuid, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
