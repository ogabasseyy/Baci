-- Index both foreign-key lookup columns used by Snapchat OAuth nonce cleanup.
-- This is append-only so existing production migration history remains intact.

BEGIN;

CREATE INDEX IF NOT EXISTS merchant_ads_oauth_state_nonces_merchant_id_idx
  ON public.merchant_ads_oauth_state_nonces (merchant_id);

CREATE INDEX IF NOT EXISTS merchant_ads_oauth_state_nonces_user_id_idx
  ON public.merchant_ads_oauth_state_nonces (user_id);

COMMIT;
