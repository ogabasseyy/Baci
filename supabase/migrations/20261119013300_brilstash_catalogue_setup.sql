ALTER TABLE private.brilstash_installations ADD COLUMN intended_credential_id uuid;
ALTER TABLE private.brilstash_installations ADD CONSTRAINT brilstash_intended_credential_fk
  FOREIGN KEY (id, intended_credential_id) REFERENCES private.brilstash_credentials (installation_id, id);

CREATE FUNCTION public.bind_brilstash_installation(
  p_merchant_id uuid, p_partner_identity text, p_single_page_only boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT private.brilstash_actor_is_operator(NULL, p_merchant_id) OR EXISTS (
    SELECT 1 FROM private.brilstash_builder_entitlements e WHERE e.user_id = (SELECT auth.uid())
  ) THEN RAISE EXCEPTION 'BrilStash operator access denied' USING ERRCODE = '42501'; END IF;

  INSERT INTO private.brilstash_installations (merchant_id, partner_identity, single_page_only)
  VALUES (p_merchant_id, p_partner_identity, p_single_page_only)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE FUNCTION public.set_brilstash_builder(p_installation_id uuid, p_builder_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_builder_user_id IS NULL THEN
    DELETE FROM private.brilstash_builder_entitlements WHERE installation_id = installation.id;
  ELSE
    IF p_builder_user_id = (SELECT auth.uid()) OR EXISTS (
      SELECT 1 FROM public.merchants m WHERE m.id = installation.merchant_id AND m.user_id = p_builder_user_id
    ) OR public.check_staff_permission(p_builder_user_id, installation.merchant_id, 'integrations', 'manage')
    THEN RAISE EXCEPTION 'BrilStash builder must be a dedicated account' USING ERRCODE = '23514'; END IF;

    INSERT INTO private.brilstash_builder_entitlements (installation_id, user_id)
    VALUES (installation.id, p_builder_user_id)
    ON CONFLICT (installation_id) DO UPDATE SET user_id = EXCLUDED.user_id;
  END IF;
END;
$$;

CREATE FUNCTION public.set_brilstash_category_mapping(
  p_installation_id uuid, p_expected_revision bigint, p_merchant_category_id uuid, p_partner_category text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_expected_revision IS DISTINCT FROM installation.catalogue_revision THEN
    RAISE EXCEPTION 'BrilStash catalogue revision changed' USING ERRCODE = '40001';
  END IF;

  IF p_partner_category IS NULL THEN
    DELETE FROM private.brilstash_category_mappings
    WHERE installation_id = installation.id AND merchant_category_id = p_merchant_category_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.categories c
      WHERE c.id = p_merchant_category_id AND c.merchant_id = installation.merchant_id AND c.is_active IS TRUE
    ) THEN RAISE EXCEPTION 'BrilStash category is not available' USING ERRCODE = '23514'; END IF;

    INSERT INTO private.brilstash_category_mappings (installation_id, merchant_category_id, partner_category)
    VALUES (installation.id, p_merchant_category_id, p_partner_category)
    ON CONFLICT (installation_id, merchant_category_id) DO UPDATE SET partner_category = EXCLUDED.partner_category;
  END IF;
END;
$$;

CREATE FUNCTION public.approve_brilstash_listing_facts(
  p_installation_id uuid, p_expected_revision bigint, p_kind text, p_source_id uuid,
  p_parent_product_id uuid, p_pilot_slot integer, p_reviewed_identity jsonb,
  p_specifications text, p_box_contents text, p_warranty text, p_evidence_reference text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE target_listing_id uuid;
DECLARE listing_external_id text;
DECLARE listing_parent uuid;
DECLARE listing_identity jsonb;
DECLARE approved_slot smallint;
DECLARE next_facts_revision bigint;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_expected_revision IS DISTINCT FROM installation.catalogue_revision THEN
    RAISE EXCEPTION 'BrilStash catalogue revision changed' USING ERRCODE = '40001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_parent_product_id AND p.merchant_id = installation.merchant_id AND p.status = 'active'
      AND CASE p_kind
        WHEN 'product' THEN p.id = p_source_id
          AND p.condition = p_reviewed_identity->>'condition'
        WHEN 'variant' THEN EXISTS (SELECT 1 FROM public.product_variants v
          WHERE v.id = p_source_id AND v.product_id = p.id AND v.merchant_id = p.merchant_id
            AND v.is_inventory_anchor IS NOT TRUE AND v.condition = p_reviewed_identity->>'condition'
            AND v.attributes = p_reviewed_identity->'attributes')
        WHEN 'offer' THEN EXISTS (SELECT 1 FROM public.product_offers o
          WHERE o.id = p_source_id AND o.product_id = p.id AND o.merchant_id = p.merchant_id
            AND o.status = 'active' AND o.condition = p_reviewed_identity->>'condition')
        ELSE false
      END
  ) THEN RAISE EXCEPTION 'BrilStash source identity is unavailable' USING ERRCODE = '23514'; END IF;

  SELECT l.id, l.external_id, l.parent_product_id, l.reviewed_identity, l.pilot_slot
  INTO target_listing_id, listing_external_id, listing_parent, listing_identity, approved_slot
  FROM private.brilstash_listings l
  WHERE l.installation_id = installation.id AND l.source_kind = p_kind AND l.source_id = p_source_id
    AND l.retired_at IS NULL;

  IF target_listing_id IS NULL THEN
    INSERT INTO private.brilstash_listings (
      installation_id, source_kind, source_id, parent_product_id, external_id, pilot_slot, reviewed_identity
    ) VALUES (
      installation.id, p_kind, p_source_id, p_parent_product_id,
      'baci-' || gen_random_uuid()::text, p_pilot_slot, p_reviewed_identity
    ) RETURNING id, external_id INTO target_listing_id, listing_external_id;
  ELSIF (listing_parent, listing_identity, approved_slot)
    IS DISTINCT FROM (p_parent_product_id, p_reviewed_identity, p_pilot_slot::smallint)
  THEN RAISE EXCEPTION 'BrilStash identity change requires separate review' USING ERRCODE = '23514'; END IF;

  SELECT COALESCE(max(f.revision), 0) + 1 INTO next_facts_revision
  FROM private.brilstash_listing_facts f
  WHERE f.installation_id = installation.id AND f.listing_id = target_listing_id;

  INSERT INTO private.brilstash_listing_facts (
    installation_id, listing_id, revision, specifications, box_contents, warranty, evidence_reference, reviewed_by
  ) VALUES (
    installation.id, target_listing_id, next_facts_revision,
    p_specifications, p_box_contents, p_warranty, p_evidence_reference, auth.uid()
  );
  UPDATE private.brilstash_listings SET approved_facts_revision = next_facts_revision
    WHERE installation_id = installation.id AND id = target_listing_id;
  RETURN jsonb_build_object('externalId', listing_external_id, 'factsRevision', next_facts_revision::text);
END;
$$;

CREATE FUNCTION public.retire_brilstash_listing(
  p_installation_id uuid, p_expected_revision bigint, p_external_id text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_expected_revision IS DISTINCT FROM installation.catalogue_revision THEN
    RAISE EXCEPTION 'BrilStash catalogue revision changed' USING ERRCODE = '40001';
  END IF;

  UPDATE private.brilstash_listings SET retired_at = clock_timestamp(), pilot_slot = NULL
  WHERE installation_id = installation.id AND external_id = p_external_id AND retired_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'BrilStash listing is unavailable' USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE FUNCTION public.rotate_brilstash_credential(
  p_installation_id uuid, p_expected_revision bigint, p_bearer_digest_hex text, p_overlap_seconds integer
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE new_id uuid;
DECLARE current_clock timestamptz;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_expected_revision IS DISTINCT FROM installation.credential_revision
    OR p_bearer_digest_hex IS NULL OR p_bearer_digest_hex !~ '^[0-9a-f]{64}$'
    OR p_overlap_seconds IS NULL OR p_overlap_seconds NOT BETWEEN 0 AND 3600
  THEN RAISE EXCEPTION 'BrilStash credential change is invalid or stale' USING ERRCODE = '23514'; END IF;

  current_clock := clock_timestamp();
  UPDATE private.brilstash_credentials
  SET revoked_at = CASE WHEN p_overlap_seconds = 0 THEN current_clock ELSE NULL END,
    expires_at = CASE WHEN p_overlap_seconds > 0 THEN
      LEAST(expires_at, current_clock + make_interval(secs => p_overlap_seconds))
      ELSE expires_at END
  WHERE installation_id = installation.id AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > current_clock);

  INSERT INTO private.brilstash_credentials (installation_id, bearer_digest, created_at)
  VALUES (installation.id, decode(p_bearer_digest_hex, 'hex'), current_clock)
  RETURNING id INTO new_id;

  UPDATE private.brilstash_installations SET intended_credential_id = new_id,
    credential_revision = credential_revision + 1 WHERE id = installation.id;
  RETURN new_id;
END;
$$;

CREATE FUNCTION public.revoke_brilstash_credential(
  p_installation_id uuid, p_expected_revision bigint, p_credential_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_expected_revision IS DISTINCT FROM installation.credential_revision THEN
    RAISE EXCEPTION 'BrilStash credential revision changed' USING ERRCODE = '40001';
  END IF;

  UPDATE private.brilstash_credentials SET revoked_at = clock_timestamp()
    WHERE installation_id = installation.id AND id = p_credential_id AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'BrilStash credential is unavailable' USING ERRCODE = '23514'; END IF;

  UPDATE private.brilstash_installations
  SET intended_credential_id = CASE WHEN intended_credential_id = p_credential_id
      THEN NULL ELSE intended_credential_id END,
    credential_revision = credential_revision + 1
  WHERE id = installation.id;
END;
$$;

CREATE FUNCTION public.inspect_brilstash_installation(p_installation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'installationId', i.id, 'merchantId', i.merchant_id, 'partnerIdentity', i.partner_identity,
    'admission', i.admission, 'activeGenerationId', i.active_generation_id,
    'catalogueRevision', i.catalogue_revision::text, 'servingRevision', i.serving_revision::text,
    'credentialRevision', i.credential_revision::text, 'intendedCredentialId', i.intended_credential_id,
    'activatedAt', i.activated_at, 'retiredAt', i.retired_at
  ) INTO result FROM private.brilstash_installations i
  WHERE i.id = p_installation_id AND private.brilstash_actor_is_operator(i.id, i.merchant_id);
  IF result IS NULL THEN
    RAISE EXCEPTION 'BrilStash operator access denied' USING ERRCODE = '42501';
  END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION private.brilstash_require_intended_release_credential()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.brilstash_installations i
    WHERE i.id = NEW.installation_id AND i.intended_credential_id = NEW.credential_id
      AND i.credential_revision = NEW.credential_revision) THEN
    RAISE EXCEPTION 'BrilStash release credential is not the intended key' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brilstash_require_intended_release_credential
  BEFORE INSERT ON private.brilstash_released_attempts
  FOR EACH ROW EXECUTE FUNCTION private.brilstash_require_intended_release_credential();

REVOKE ALL ON FUNCTION private.brilstash_require_intended_release_credential()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.inspect_brilstash_installation(uuid),
  public.bind_brilstash_installation(uuid, text, boolean),
  public.set_brilstash_builder(uuid, uuid),
  public.set_brilstash_category_mapping(uuid, bigint, uuid, text),
  public.approve_brilstash_listing_facts(uuid, bigint, text, uuid, uuid, integer, jsonb, text, text, text, text),
  public.retire_brilstash_listing(uuid, bigint, text),
  public.rotate_brilstash_credential(uuid, bigint, text, integer),
  public.revoke_brilstash_credential(uuid, bigint, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.inspect_brilstash_installation(uuid),
  public.bind_brilstash_installation(uuid, text, boolean),
  public.set_brilstash_builder(uuid, uuid),
  public.set_brilstash_category_mapping(uuid, bigint, uuid, text),
  public.approve_brilstash_listing_facts(uuid, bigint, text, uuid, uuid, integer, jsonb, text, text, text, text),
  public.retire_brilstash_listing(uuid, bigint, text),
  public.rotate_brilstash_credential(uuid, bigint, text, integer),
  public.revoke_brilstash_credential(uuid, bigint, uuid)
  TO authenticated;
