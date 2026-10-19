-- Allow the one-shot UCP create-recovery marker to be cleared after
-- migration: the migrated-write fence rejected every update to a
-- migrated agentic_cart_sessions row, so the marker clear after a
-- successful recovery silently failed and later legitimate canonical
-- lane updates were reverted to the original create lanes on the next
-- read. The carve-out permits only an update that changes nothing but
-- metadata (and updated_at) and flips create_recovery_pending from
-- true to false, leaving every other migrated-write block intact.
CREATE OR REPLACE FUNCTION public.commerce_cart_block_migrated_write()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF OLD.migrated_to_cart_id IS NOT NULL THEN
    IF (pg_catalog.to_jsonb(NEW) - 'metadata' - 'updated_at')
         IS NOT DISTINCT FROM
         (pg_catalog.to_jsonb(OLD) - 'metadata' - 'updated_at')
       AND (pg_catalog.to_jsonb(OLD) -> 'metadata' ->> 'create_recovery_pending') = 'true'
       AND (pg_catalog.to_jsonb(NEW) -> 'metadata' ->> 'create_recovery_pending') = 'false'
       AND ((pg_catalog.to_jsonb(NEW) -> 'metadata') - 'create_recovery_pending')
           IS NOT DISTINCT FROM
           ((pg_catalog.to_jsonb(OLD) -> 'metadata') - 'create_recovery_pending') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'migrated cart is read-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
