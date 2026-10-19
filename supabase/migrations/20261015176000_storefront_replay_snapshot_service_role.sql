-- Restrict the committed-order replay snapshot to the server-side
-- service role: the snapshot resolves solely by (merchant,
-- idempotency key) and returns committed amounts/items, so anon and
-- authenticated PostgREST callers must not execute it directly. The
-- public orders route now performs this probe on its admin client.
REVOKE EXECUTE ON FUNCTION public.storefront_checkout_replay_snapshot(uuid, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_checkout_replay_snapshot(uuid, text)
  TO service_role;
