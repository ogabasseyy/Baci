-- Prepare replay for wallet summary return-type expansion by cascading away
-- dependent objects before the projection migration recreates get_wallet_summary.
BEGIN;

DROP FUNCTION IF EXISTS public.get_wallet_summary(uuid) CASCADE;

COMMIT;
