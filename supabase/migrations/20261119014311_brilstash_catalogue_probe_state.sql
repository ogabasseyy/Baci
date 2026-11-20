CREATE FUNCTION public.inspect_brilstash_probe_state(p_installation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE probe_time constant timestamptz := clock_timestamp();
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'installationId', i.id, 'generationId', g.id, 'credentialId', c.id,
    'catalogueRevision', i.catalogue_revision::text,
    'servingRevision', i.serving_revision::text,
    'credentialRevision', i.credential_revision::text,
    'payloadDigest', g.payload_digest, 'totalCount', jsonb_array_length(g.payload)
  ) INTO result
  FROM private.brilstash_installations i
  JOIN private.brilstash_generations g ON g.installation_id = i.id AND g.id = i.active_generation_id
    AND g.catalogue_revision = i.catalogue_revision
  JOIN private.brilstash_candidate_approvals a ON a.installation_id = i.id AND a.candidate_id = g.id
    AND a.catalogue_revision = g.catalogue_revision AND a.payload_digest = g.payload_digest
  JOIN private.brilstash_credentials c ON c.installation_id = i.id AND c.id = i.intended_credential_id
  WHERE i.id = p_installation_id AND private.brilstash_actor_is_operator(i.id, i.merchant_id)
    AND i.admission = 'open' AND i.retired_at IS NULL AND i.activated_at IS NOT NULL
    AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > probe_time)
    AND private.brilstash_read_is_fresh(i.id, g.source_read_at, probe_time)
    AND private.brilstash_active_generation_is_eligible(i.id, g.id);
  IF result IS NULL THEN
    RAISE EXCEPTION 'BrilStash probe state unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.inspect_brilstash_probe_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inspect_brilstash_probe_state(uuid) TO authenticated;
