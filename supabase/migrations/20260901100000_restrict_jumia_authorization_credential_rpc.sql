-- Keep the credential-returning Jumia RPC behind the server-only credential
-- boundary. User-facing callers may still use metadata and mutation RPCs, but
-- encrypted credential ciphertext is never available to PostgREST roles.

REVOKE ALL ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid)
  TO service_role;
