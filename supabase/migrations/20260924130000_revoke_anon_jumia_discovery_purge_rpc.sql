-- Revoke the public anon grant on the Jumia discovery purge RPC.
--
-- The RPC is SECURITY DEFINER and reports how many expired or consumed
-- discovery envelopes it deleted across all merchants. Granting it to anon
-- lets anyone with the public anon key invoke it directly, bypassing the
-- CRON_SECRET-protected wrapper route entirely. The cron route now calls it
-- with the server-only service role, so anon execution is closed again.

REVOKE EXECUTE ON FUNCTION public.purge_expired_jumia_self_authorization_discoveries()
FROM anon;
