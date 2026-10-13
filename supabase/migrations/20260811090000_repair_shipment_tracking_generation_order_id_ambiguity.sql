-- The RETURNS TABLE(order_id ...) output variable conflicts with ON CONFLICT
-- (order_id) inside PL/pgSQL. Use the primary-key constraint to keep the
-- shipment insert trigger executable without changing the function contract.
CREATE OR REPLACE FUNCTION private.allocate_shipment_tracking_generation(
  p_old_order_id uuid,
  p_new_order_id uuid
)
RETURNS TABLE (order_id uuid, tracking_timeline_generation integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH candidate_order_ids AS (
    SELECT DISTINCT candidate.order_id
    FROM pg_catalog.unnest(ARRAY[p_old_order_id, p_new_order_id]::uuid[])
      AS candidate(order_id)
    WHERE candidate.order_id IS NOT NULL
    ORDER BY candidate.order_id
  ), allocations AS (
    INSERT INTO private.order_tracking_timeline_generations AS allocator (
      order_id,
      last_generation,
      updated_at
    )
    SELECT candidate.order_id, 1, pg_catalog.now()
    FROM candidate_order_ids AS candidate
    ORDER BY candidate.order_id
    ON CONFLICT ON CONSTRAINT order_tracking_timeline_generations_pkey DO UPDATE
    SET
      last_generation = allocator.last_generation + 1,
      updated_at = pg_catalog.now()
    RETURNING allocator.order_id, allocator.last_generation
  )
  SELECT allocator.order_id, allocator.last_generation
  FROM allocations AS allocator
  ORDER BY allocator.order_id;
END;
$$;

ALTER FUNCTION private.allocate_shipment_tracking_generation(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.allocate_shipment_tracking_generation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
