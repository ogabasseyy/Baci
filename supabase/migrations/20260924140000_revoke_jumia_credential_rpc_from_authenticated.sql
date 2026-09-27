-- Remove browser-reachable execution of the Jumia credential RPC.
-- The authenticated grant let any manage-authorized JWT invoke the
-- SECURITY DEFINER function directly from a browser Supabase client and
-- download credential ciphertext plus binding metadata. Execution is now
-- limited to the server credential role; server routes authorize the
-- owner/manage check in loadJumiaAuthorizationGrant before executing
-- with the server-only credential client. The function body is
-- unchanged, so the service-role integration guard still applies.

REVOKE ALL ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid)
  TO service_role;
