-- Constraint names are schema-local, so another table must not satisfy
-- the connector-grant uniqueness assertion. Historical migrations remain intact.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connector_grants_connection_id_key'
      AND conrelid = 'public.connector_grants'::regclass
  ) THEN
    ALTER TABLE public.connector_grants
      ADD CONSTRAINT connector_grants_connection_id_key UNIQUE (connection_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connector_grants_token_hash_key'
      AND conrelid = 'public.connector_grants'::regclass
  ) THEN
    ALTER TABLE public.connector_grants
      ADD CONSTRAINT connector_grants_token_hash_key UNIQUE (token_hash);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connector_grants_refresh_token_hash_key'
      AND conrelid = 'public.connector_grants'::regclass
  ) THEN
    ALTER TABLE public.connector_grants
      ADD CONSTRAINT connector_grants_refresh_token_hash_key UNIQUE (refresh_token_hash);
  END IF;
END
$$;
