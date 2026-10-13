BEGIN;

-- Google spend writes must pass through the service-only bounded replacement
-- RPC. Retain the legacy function for migration compatibility, but remove
-- every PostgREST execution path so browsers and privileged API clients cannot
-- bypass account/window replacement semantics.
REVOKE ALL ON FUNCTION public.upsert_google_ads_spend_daily(
  uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
