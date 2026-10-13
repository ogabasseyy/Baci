-- Snapchat disconnects revoke the connection while preserving reporting history.
-- Spend retention/deletion belongs to the separate Ads spend boundary; the old
-- combined RPC is retired so no credential-bound caller can erase spend rows.

BEGIN;

DROP FUNCTION IF EXISTS public.delete_snapchat_ads_connection_and_spend(uuid);

COMMIT;
