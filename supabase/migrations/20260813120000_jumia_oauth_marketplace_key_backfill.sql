-- Legacy OAuth integrations kept marketplace_key = 'default', but OAuth callback
-- paths now upsert with marketplace_key = 'oauth'. Backfill before reconnects
-- create duplicate active integrations under the widened unique key.

UPDATE public.marketplace_integrations
SET marketplace_key = 'oauth'
WHERE platform = 'jumia'
  AND connection_method = 'oauth'
  AND marketplace_key = 'default';
