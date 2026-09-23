-- Allow authenticated server routes to call the tenant-scoped credential RPC.
-- The SECURITY DEFINER function enforces merchant ownership or staff
-- permission checks; dedicated workers retain their service-role execution.

REVOKE ALL ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid)
  TO authenticated, service_role;
