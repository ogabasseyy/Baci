-- Short-lived server-side handoff for Jumia self-authorization discovery.
-- Rotated credentials never return to the browser after discovery.

CREATE TABLE IF NOT EXISTS public.jumia_self_authorization_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_key_hash text NOT NULL,
  credential_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jumia_self_authorization_discoveries_client_key_hash_check
    CHECK (client_key_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT jumia_self_authorization_discoveries_credential_ciphertext_check
    CHECK (char_length(credential_ciphertext) BETWEEN 32 AND 16384)
);

CREATE INDEX IF NOT EXISTS idx_jumia_self_authorization_discoveries_expires
  ON public.jumia_self_authorization_discoveries (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.jumia_self_authorization_discoveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_public_access
ON public.jumia_self_authorization_discoveries
TO authenticated, anon
USING (false)
WITH CHECK (false);

REVOKE ALL ON TABLE public.jumia_self_authorization_discoveries FROM PUBLIC;
GRANT ALL ON TABLE public.jumia_self_authorization_discoveries TO service_role;
