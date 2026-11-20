-- Only the configured feed deployment can prove a request passed its
-- ingress checks. The database still authenticates the installation bearer.
CREATE FUNCTION private.brilstash_ingress_is_authorized(p_bearer text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE proof text;
DECLARE issued text;
DECLARE secret text;
DECLARE expected text;
BEGIN
  proof := nullif(current_setting('request.headers', true), '')::jsonb->>'x-baci-brilstash-ingress';
  IF proof IS NULL OR proof !~ '^[0-9]{10}[.][a-f0-9]{64}$' THEN RETURN false; END IF;
  issued := split_part(proof, '.', 1);
  IF issued::bigint < floor(extract(epoch FROM statement_timestamp())) - 15
    OR issued::bigint > floor(extract(epoch FROM statement_timestamp())) + 5
  THEN RETURN false; END IF;

  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT CASE WHEN count(*) = 1 THEN min(decrypted_secret) END FROM vault.decrypted_secrets WHERE name = $1'
      INTO secret USING 'brilstash_feed_ingress_key';
  END IF;
  IF secret IS NULL OR secret !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;

  expected := encode(extensions.hmac('baci:brilstash-feed:v1:' || issued || ':' || p_bearer, secret, 'sha256'), 'hex');
  RETURN sha256(convert_to(split_part(proof, '.', 2), 'UTF8')) = sha256(convert_to(expected, 'UTF8'));
END;
$$;
REVOKE ALL ON FUNCTION private.brilstash_ingress_is_authorized(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.brilstash_ingress_is_authorized(text) TO baci_brilstash_reader;

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
    RETURN jsonb_build_object('status', 'unauthorized');
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
    OR (access_claim.single_page_only AND (p_page <> 1 OR p_limit < 7 OR p_min_price <> 0))
  THEN RETURN jsonb_build_object('status', 'invalid_query'); END IF;

  IF access_claim.admission <> 'open' OR access_claim.retired_at IS NOT NULL
    OR access_claim.generation_id IS NULL
    OR NOT private.brilstash_read_is_fresh(access_claim.installation_id, access_claim.source_read_at, statement_timestamp())
    OR NOT private.brilstash_active_generation_is_eligible(access_claim.installation_id, access_claim.generation_id)
  THEN RETURN jsonb_build_object('status', 'unavailable'); END IF;

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
