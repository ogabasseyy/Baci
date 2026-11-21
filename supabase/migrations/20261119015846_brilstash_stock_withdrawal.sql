CREATE FUNCTION public.approve_brilstash_stock_withdrawal(
  p_installation_id uuid, p_expected_revision bigint, p_external_id text, p_evidence_reference text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE listing_id uuid;
DECLARE approval_id uuid;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_expected_revision IS DISTINCT FROM installation.catalogue_revision THEN
    RAISE EXCEPTION 'BrilStash catalogue revision changed' USING ERRCODE = '40001';
  END IF;

  -- Only an exact, still-public source from the current published generation
  -- can qualify. Null counts and ambiguous stock are not untracked stock.
  SELECT l.id INTO listing_id
  FROM private.brilstash_listings l
  JOIN private.brilstash_generations prior ON prior.installation_id = l.installation_id
    AND prior.id = installation.active_generation_id
  JOIN LATERAL private.brilstash_source_rows(installation.id, installation.merchant_id) source(row)
    ON source.row->>'externalId' = l.external_id
  WHERE l.installation_id = installation.id AND l.external_id = p_external_id
    AND l.retired_at IS NULL AND installation.activated_at IS NOT NULL
    AND source.row->>'visible' = 'true' AND source.row->'inventory'->>'kind' = 'untracked'
    AND prior.payload @> jsonb_build_array(jsonb_build_object('external_id', l.external_id))
    AND prior.source_manifest @> jsonb_build_array(jsonb_build_object(
      'externalId', l.external_id, 'sourceKind', l.source_kind, 'sourceId', l.source_id,
      'parentProductId', l.parent_product_id, 'reviewedIdentity', l.reviewed_identity
    ));
  IF listing_id IS NULL OR COALESCE(char_length(btrim(p_evidence_reference)), 0) NOT BETWEEN 1 AND 1024 THEN
    RAISE EXCEPTION 'BrilStash source does not qualify for zero-stock withdrawal' USING ERRCODE = '23514';
  END IF;

  INSERT INTO private.brilstash_stock_withdrawals(
    installation_id, listing_id, prior_generation_id, evidence_reference, reviewed_by
  ) VALUES (installation.id, listing_id, installation.active_generation_id, p_evidence_reference, auth.uid())
  RETURNING id INTO approval_id;
  UPDATE private.brilstash_installations SET catalogue_revision = catalogue_revision + 1
  WHERE id = installation.id;
  RETURN approval_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_brilstash_stock_withdrawal(uuid, bigint, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_brilstash_stock_withdrawal(uuid, bigint, text, text) TO authenticated;
