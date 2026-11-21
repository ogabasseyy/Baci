-- Per-installation publication approvals. Source IDs are retained even when
-- the storefront removes the original row. The loader must recheck visibility.
CREATE TABLE private.brilstash_listings (
  installation_id uuid NOT NULL REFERENCES private.brilstash_installations(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN ('product', 'variant', 'offer')),
  source_id uuid NOT NULL,
  parent_product_id uuid NOT NULL,
  external_id text NOT NULL CHECK (
    external_id = btrim(external_id) AND char_length(external_id) BETWEEN 1 AND 256
  ),
  pilot_slot smallint CHECK (pilot_slot BETWEEN 1 AND 7),
  retired_at timestamptz,
  reviewed_identity jsonb NOT NULL CHECK (
    jsonb_typeof(reviewed_identity) = 'object'
    AND COALESCE(
      reviewed_identity->>'condition' IN ('new', 'used', 'open_box', 'uk_used', 'refurbished'), false
    )
  ),
  approved_facts_revision bigint,
  CHECK (source_kind <> 'product' OR source_id = parent_product_id),
  CHECK ((retired_at IS NULL) = (pilot_slot IS NOT NULL)),
  PRIMARY KEY (installation_id, id),
  UNIQUE (installation_id, external_id),
  UNIQUE (installation_id, pilot_slot)
);

CREATE UNIQUE INDEX brilstash_listings_active_source_idx
  ON private.brilstash_listings (installation_id, source_kind, source_id)
  WHERE retired_at IS NULL;

CREATE TABLE private.brilstash_listing_facts (
  installation_id uuid NOT NULL,
  listing_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  specifications text NOT NULL CHECK (btrim(specifications) <> ''),
  box_contents text NOT NULL CHECK (btrim(box_contents) <> ''),
  warranty text NOT NULL CHECK (btrim(warranty) <> ''),
  evidence_reference text NOT NULL CHECK (btrim(evidence_reference) <> ''),
  -- Preserve an audit identifier without blocking removal of an auth account.
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, listing_id, revision),
  FOREIGN KEY (installation_id, listing_id)
    REFERENCES private.brilstash_listings (installation_id, id)
);

ALTER TABLE private.brilstash_listings
  ADD CONSTRAINT brilstash_listings_approved_facts_fk
  FOREIGN KEY (installation_id, id, approved_facts_revision)
  REFERENCES private.brilstash_listing_facts (installation_id, listing_id, revision);

CREATE TABLE private.brilstash_category_mappings (
  installation_id uuid NOT NULL REFERENCES private.brilstash_installations(id),
  merchant_category_id uuid NOT NULL,
  partner_category text NOT NULL CHECK (
    partner_category = btrim(partner_category) AND partner_category <> ''
  ),
  PRIMARY KEY (installation_id, merchant_category_id)
);

CREATE FUNCTION private.protect_brilstash_listing()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BrilStash listing history cannot be deleted'
      USING ERRCODE = '23514';
  END IF;
  IF (NEW.installation_id, NEW.id, NEW.external_id)
      IS DISTINCT FROM (OLD.installation_id, OLD.id, OLD.external_id)
    OR (OLD.retired_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
  THEN
    RAISE EXCEPTION 'BrilStash listing identity and retirement history are permanent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.protect_brilstash_listing_facts()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'BrilStash reviewed facts must be replaced by a new revision'
    USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION private.bump_brilstash_assortment_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Operator RPCs must lock the installation before changing child rows.
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
    IF NEW.installation_id IS DISTINCT FROM OLD.installation_id THEN
      RAISE EXCEPTION 'BrilStash assortment scope cannot be reassigned'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE private.brilstash_installations
  SET catalogue_revision = catalogue_revision + 1
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.installation_id ELSE NEW.installation_id END;
  RETURN NULL;
END;
$$;

CREATE TRIGGER protect_brilstash_listing
  BEFORE UPDATE OR DELETE ON private.brilstash_listings
  FOR EACH ROW EXECUTE FUNCTION private.protect_brilstash_listing();

CREATE TRIGGER protect_brilstash_listing_facts
  BEFORE UPDATE OR DELETE ON private.brilstash_listing_facts
  FOR EACH ROW EXECUTE FUNCTION private.protect_brilstash_listing_facts();

CREATE TRIGGER bump_brilstash_listing_revision
  AFTER INSERT OR UPDATE ON private.brilstash_listings
  FOR EACH ROW EXECUTE FUNCTION private.bump_brilstash_assortment_revision();

CREATE TRIGGER bump_brilstash_category_revision
  AFTER INSERT OR UPDATE OR DELETE ON private.brilstash_category_mappings
  FOR EACH ROW EXECUTE FUNCTION private.bump_brilstash_assortment_revision();

ALTER TABLE private.brilstash_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brilstash_listing_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brilstash_category_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY brilstash_no_direct_access ON private.brilstash_listings
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY brilstash_no_direct_access ON private.brilstash_listing_facts
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY brilstash_no_direct_access ON private.brilstash_category_mappings
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE private.brilstash_listings, private.brilstash_listing_facts,
  private.brilstash_category_mappings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_brilstash_listing(),
  private.protect_brilstash_listing_facts(), private.bump_brilstash_assortment_revision()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.brilstash_stock_withdrawals (
  installation_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  prior_generation_id uuid NOT NULL,
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  evidence_reference text NOT NULL CHECK (char_length(btrim(evidence_reference)) BETWEEN 1 AND 1024),
  PRIMARY KEY (installation_id, id),
  UNIQUE (installation_id, listing_id, prior_generation_id),
  FOREIGN KEY (installation_id, listing_id) REFERENCES private.brilstash_listings(installation_id, id),
  FOREIGN KEY (installation_id, prior_generation_id) REFERENCES private.brilstash_generations(installation_id, id)
);

CREATE INDEX brilstash_withdrawal_prior_generation_idx
  ON private.brilstash_stock_withdrawals (installation_id, prior_generation_id);
ALTER TABLE private.brilstash_stock_withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY brilstash_no_direct_access ON private.brilstash_stock_withdrawals
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.brilstash_stock_withdrawals FROM PUBLIC, anon, authenticated, service_role;
