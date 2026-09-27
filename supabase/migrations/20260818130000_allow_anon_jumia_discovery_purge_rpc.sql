-- The purge RPC deletes only expired or already-consumed discovery envelopes.
-- Allow the CRON_SECRET-protected route to call it with a stateless anon client
-- instead of introducing a service-role client into the request graph.

GRANT EXECUTE ON FUNCTION public.purge_expired_jumia_self_authorization_discoveries()
TO anon;
