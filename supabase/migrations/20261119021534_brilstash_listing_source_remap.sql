CREATE TABLE private.brilstash_listing_remaps (
  installation_id uuid NOT NULL,
  listing_id uuid NOT NULL,
  catalogue_revision bigint NOT NULL,
  previous_kind text NOT NULL,
  previous_source_id uuid NOT NULL,
  previous_parent_product_id uuid NOT NULL,
  previous_identity jsonb NOT NULL,
  replacement_kind text NOT NULL,
  replacement_source_id uuid NOT NULL,
  replacement_parent_product_id uuid NOT NULL,
  replacement_identity jsonb NOT NULL,
  evidence_reference text NOT NULL CHECK (char_length(btrim(evidence_reference)) BETWEEN 1 AND 1024),
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, catalogue_revision),
  FOREIGN KEY (installation_id, listing_id) REFERENCES private.brilstash_listings(installation_id, id)
);
CREATE INDEX brilstash_listing_remaps_listing_idx
  ON private.brilstash_listing_remaps(installation_id, listing_id);
CREATE INDEX brilstash_listing_remaps_source_idx
  ON private.brilstash_listing_remaps(installation_id, previous_kind, previous_source_id);

ALTER TABLE private.brilstash_listing_remaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY brilstash_no_direct_access ON private.brilstash_listing_remaps
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.brilstash_listing_remaps FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.brilstash_preserve_remapped_source_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.brilstash_listing_remaps r
    WHERE r.installation_id = NEW.installation_id AND r.previous_kind = NEW.source_kind
      AND r.previous_source_id = NEW.source_id AND r.listing_id <> NEW.id)
  THEN RAISE EXCEPTION 'BrilStash source is already tied to a reviewed listing history' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brilstash_preserve_remapped_source_identity
  BEFORE INSERT OR UPDATE OF source_kind, source_id ON private.brilstash_listings
  FOR EACH ROW EXECUTE FUNCTION private.brilstash_preserve_remapped_source_identity();

-- The operator verifies equivalence. The transaction independently checks
-- the replacement's current public identity and preserves both source records.
CREATE FUNCTION public.remap_brilstash_listing(
  p_installation_id uuid, p_expected_revision bigint, p_external_id text, p_kind text,
  p_source_id uuid, p_parent_product_id uuid, p_reviewed_identity jsonb, p_evidence_reference text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE original record;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_expected_revision IS DISTINCT FROM installation.catalogue_revision THEN
    RAISE EXCEPTION 'BrilStash catalogue revision changed' USING ERRCODE = '40001';
  END IF;

  SELECT l.id, l.source_kind, l.source_id, l.parent_product_id, l.reviewed_identity INTO original
  FROM private.brilstash_listings l
  WHERE l.installation_id = installation.id AND l.external_id = p_external_id AND l.retired_at IS NULL;
  IF original.id IS NULL OR installation.admission = 'closed'
    OR (p_kind, p_source_id) IS NOT DISTINCT FROM (original.source_kind, original.source_id)
    OR (p_reviewed_identity->>'condition') IS DISTINCT FROM (original.reviewed_identity->>'condition')
    OR ((original.reviewed_identity ? 'attributes') AND
      (p_reviewed_identity->'attributes') IS DISTINCT FROM (original.reviewed_identity->'attributes'))
    OR COALESCE(char_length(btrim(p_evidence_reference)), 0) NOT BETWEEN 1 AND 1024
    OR EXISTS (SELECT 1 FROM private.brilstash_released_attempts a
      WHERE a.installation_id = installation.id AND a.resolved_at IS NULL)
  THEN RAISE EXCEPTION 'BrilStash replacement does not qualify as the same sellable' USING ERRCODE = '23514'; END IF;

  UPDATE private.brilstash_listings
  SET source_kind = p_kind, source_id = p_source_id, parent_product_id = p_parent_product_id,
    reviewed_identity = p_reviewed_identity, approved_facts_revision = NULL
  WHERE installation_id = installation.id AND id = original.id;
  IF NOT EXISTS (
    SELECT 1 FROM private.brilstash_source_rows(installation.id, installation.merchant_id) source(row)
    WHERE source.row->>'externalId' = p_external_id AND source.row->>'visible' = 'true'
  ) THEN RAISE EXCEPTION 'BrilStash replacement source is not publicly eligible' USING ERRCODE = '23514'; END IF;

  INSERT INTO private.brilstash_listing_remaps(
    installation_id, listing_id, catalogue_revision,
    previous_kind, previous_source_id, previous_parent_product_id, previous_identity,
    replacement_kind, replacement_source_id, replacement_parent_product_id, replacement_identity,
    evidence_reference, reviewed_by
  ) VALUES (
    installation.id, original.id, installation.catalogue_revision + 1,
    original.source_kind, original.source_id, original.parent_product_id, original.reviewed_identity,
    p_kind, p_source_id, p_parent_product_id, p_reviewed_identity, p_evidence_reference, auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION private.brilstash_preserve_remapped_source_identity(),
  public.remap_brilstash_listing(uuid, bigint, text, text, uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remap_brilstash_listing(uuid, bigint, text, text, uuid, uuid, jsonb, text)
  TO authenticated;
