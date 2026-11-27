-- Reject under-floor prices before an on-demand generation can be approved.
CREATE FUNCTION private.brilstash_validate_on_demand_price_floor()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private.brilstash_installations i
    WHERE i.id = NEW.installation_id AND i.source_on_demand
  ) AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.payload) item
    WHERE (item->>'price_naira')::numeric < 250000
  ) THEN
    RAISE EXCEPTION 'BrilStash pilot listings must meet the 250000 NGN price floor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_brilstash_on_demand_price_floor
BEFORE INSERT ON private.brilstash_generations
FOR EACH ROW EXECUTE FUNCTION private.brilstash_validate_on_demand_price_floor();

REVOKE ALL ON FUNCTION private.brilstash_validate_on_demand_price_floor()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_brilstash_page(p_bearer text, p_page integer, p_limit integer, p_min_price numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE access_claim record;
DECLARE page_result jsonb;
BEGIN
  IF p_bearer IS NULL OR octet_length(p_bearer) NOT BETWEEN 32 AND 256
    OR p_bearer !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;
  IF NOT private.brilstash_ingress_is_authorized(p_bearer) THEN
    RETURN jsonb_build_object('status', 'ingress_unavailable');
  END IF;
  SELECT i.id AS installation_id, i.admission, i.retired_at, i.single_page_only,
    c.id AS credential_id, g.id AS generation_id, g.source_read_at, g.payload, g.payload_digest
  INTO access_claim
  FROM private.brilstash_credentials c
  JOIN private.brilstash_installations i ON i.id = c.installation_id
  LEFT JOIN private.brilstash_generations g ON g.installation_id = i.id AND g.id = i.active_generation_id
  WHERE c.bearer_digest = sha256(convert_to(p_bearer, 'UTF8'))
    AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > statement_timestamp());
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unauthorized'); END IF;

  IF p_page IS NULL OR p_page < 1 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR p_min_price IS NULL OR p_min_price NOT BETWEEN 0 AND 9007199254740991
    OR (access_claim.single_page_only AND (p_page <> 1 OR p_limit < 7 OR p_min_price NOT IN (0, 250000)))
  THEN RETURN jsonb_build_object('status', 'invalid_query'); END IF;

  IF access_claim.admission <> 'open' OR access_claim.retired_at IS NOT NULL
    OR access_claim.generation_id IS NULL
    OR NOT private.brilstash_read_is_fresh(access_claim.installation_id, access_claim.source_read_at, statement_timestamp())
    OR NOT private.brilstash_active_generation_is_eligible(access_claim.installation_id, access_claim.generation_id)
  THEN RETURN jsonb_build_object('status', 'unavailable'); END IF;

  -- A filtered subset would make BrilStash remove otherwise active listings.
  IF access_claim.single_page_only AND p_min_price = 250000 AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(access_claim.payload) item
    WHERE (item->>'price_naira')::numeric < p_min_price
  ) THEN RETURN jsonb_build_object('status', 'unavailable'); END IF;

  WITH matched AS MATERIALIZED (
    SELECT item, ord FROM jsonb_array_elements(access_claim.payload) WITH ORDINALITY rows(item, ord)
    WHERE (item->>'price_naira')::numeric >= p_min_price
  ), paged AS (
    SELECT item, ord FROM matched
    ORDER BY ord LIMIT p_limit OFFSET ((p_page::bigint - 1) * p_limit)
  )
  SELECT jsonb_build_object(
    'status', 'ok', 'products', COALESCE((SELECT jsonb_agg(item ORDER BY ord) FROM paged), '[]'::jsonb),
    'totalCount', count(*), 'totalPages', (count(*) + p_limit - 1) / p_limit,
    'generationId', access_claim.generation_id, 'credentialId', access_claim.credential_id,
    'payloadDigest', access_claim.payload_digest
  ) INTO page_result FROM matched;
  RETURN page_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_brilstash_handoff_probe(
  p_installation_id uuid, p_state jsonb, p_request_id uuid, p_feed_url text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE probe_id uuid;
DECLARE required_min_price text;
BEGIN
  PERFORM private.brilstash_lock_operator(p_installation_id);
  SELECT CASE WHEN i.source_on_demand THEN '250000' ELSE '0' END INTO STRICT required_min_price
  FROM private.brilstash_installations i WHERE i.id = p_installation_id;
  IF p_state IS DISTINCT FROM public.inspect_brilstash_probe_state(p_installation_id)
    OR p_request_id IS NULL
    OR p_feed_url IS NULL OR char_length(p_feed_url) > 400
    OR p_feed_url !~ ('^https://[a-z0-9][a-z0-9.-]*/partners/yield/brilpay/products\?page=1&limit=100&min_price=' ||
      required_min_price || '$')
    OR EXISTS (SELECT 1 FROM private.brilstash_saved_connections c WHERE c.request_id = p_request_id)
  THEN RAISE EXCEPTION 'BrilStash probe does not match current serving state' USING ERRCODE = '23514'; END IF;

  INSERT INTO private.brilstash_handoff_probes(installation_id, request_id, state_claim, feed_url, recorded_by)
  VALUES (p_installation_id, p_request_id, p_state, p_feed_url, auth.uid())
  ON CONFLICT (request_id) DO NOTHING RETURNING id INTO probe_id;
  IF probe_id IS NULL THEN
    SELECT p.id INTO probe_id FROM private.brilstash_handoff_probes p
    WHERE p.installation_id = p_installation_id AND p.request_id = p_request_id
      AND p.state_claim = p_state AND p.feed_url = p_feed_url;
  END IF;
  IF probe_id IS NULL THEN
    RAISE EXCEPTION 'BrilStash probe request already recorded with different details' USING ERRCODE = '23514';
  END IF;
  RETURN probe_id;
END;
$$;
