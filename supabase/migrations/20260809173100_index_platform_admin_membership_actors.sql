-- disable-transaction

-- The membership primary/unique keys begin with membership and target-user
-- identifiers, so foreign-key actor deletion needs dedicated leading indexes.
-- Recover invalid concurrent indexes left by an interrupted prior attempt;
-- IF NOT EXISTS considers those unusable indexes present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_catalog.pg_index AS index_state
      ON index_state.indexrelid = index_class.oid
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'platform_admin_memberships_granted_by_idx'
      AND NOT index_state.indisvalid
  ) THEN
    DROP INDEX IF EXISTS public.platform_admin_memberships_granted_by_idx;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_catalog.pg_index AS index_state
      ON index_state.indexrelid = index_class.oid
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'platform_admin_memberships_revoked_by_idx'
      AND NOT index_state.indisvalid
  ) THEN
    DROP INDEX IF EXISTS public.platform_admin_memberships_revoked_by_idx;
  END IF;
END;
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_admin_memberships_granted_by_idx
  ON public.platform_admin_memberships (granted_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_admin_memberships_revoked_by_idx
  ON public.platform_admin_memberships (revoked_by);
