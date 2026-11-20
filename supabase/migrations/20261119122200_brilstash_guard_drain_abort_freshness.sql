-- Require the prior generation to satisfy the read freshness gate through the upcoming pull.
CREATE OR REPLACE FUNCTION public.abort_brilstash_drain(p_installation_id uuid, p_closure_revision bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE current_clock timestamptz;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  current_clock := private.brilstash_clock();
  IF installation.admission <> 'closed'
    OR installation.serving_revision IS DISTINCT FROM p_closure_revision
  THEN RAISE EXCEPTION 'BrilStash closure cannot be aborted' USING ERRCODE = '23514'; END IF;

  UPDATE private.brilstash_drains d SET outcome = 'aborted', completed_at = current_clock
  FROM private.brilstash_generations g
  WHERE d.installation_id = installation.id AND d.closure_revision = p_closure_revision
    AND d.old_generation_id = installation.active_generation_id AND d.outcome IS NULL
    AND g.installation_id = d.installation_id AND g.id = d.old_generation_id
    AND private.brilstash_read_is_fresh(installation.id, g.source_read_at, current_clock, true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BrilStash prior generation is no longer fresh' USING ERRCODE = '23514';
  END IF;

  UPDATE private.brilstash_installations
    SET admission = 'open', serving_revision = serving_revision + 1
    WHERE id = installation.id;
  -- Reuse the complete serving gate. Failure rolls back the temporary open state.
  IF NOT private.brilstash_active_generation_is_eligible(installation.id, installation.active_generation_id) THEN
    RAISE EXCEPTION 'BrilStash prior generation is no longer eligible' USING ERRCODE = '23514';
  END IF;
END;
$$;
