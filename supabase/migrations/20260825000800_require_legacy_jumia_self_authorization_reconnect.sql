-- Rows created by the legacy self-authorization endpoint predate the encrypted
-- grant model and were defaulted to OAuth when connection_method was added.
-- They cannot be migrated safely because the legacy row did not retain its
-- client id. Remove the plaintext refresh credential and require an explicit
-- reconnect through the encrypted self-authorization flow.
UPDATE public.marketplace_integrations
SET
  is_active = false,
  refresh_token = NULL,
  sync_error = 'Reconnect Jumia to continue background synchronization',
  updated_at = now()
WHERE platform = 'jumia'
  AND connection_method = 'oauth'
  AND jumia_authorization_id IS NULL
  AND access_token IS NULL
  AND refresh_token IS NOT NULL
  AND token_expires_at IS NULL;
