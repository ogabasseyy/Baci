CREATE TABLE private.brilstash_installation_retirements (
  installation_id uuid PRIMARY KEY REFERENCES private.brilstash_installations(id),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1024),
  partner_evidence_reference text CHECK (char_length(btrim(partner_evidence_reference)) BETWEEN 1 AND 1024),
  retired_by uuid NOT NULL,
  retired_at timestamptz NOT NULL
);
ALTER TABLE private.brilstash_installation_retirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY brilstash_no_direct_access ON private.brilstash_installation_retirements
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.brilstash_installation_retirements FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.retire_brilstash_installation(
  p_installation_id uuid, p_expected_revision bigint, p_reason text, p_partner_evidence_reference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE retirement_time timestamptz;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_expected_revision IS DISTINCT FROM installation.catalogue_revision THEN
    RAISE EXCEPTION 'BrilStash catalogue revision changed' USING ERRCODE = '40001';
  END IF;
  IF COALESCE(char_length(btrim(p_reason)), 0) NOT BETWEEN 1 AND 1024
    OR (installation.activated_at IS NOT NULL AND (
      installation.admission <> 'suspended'
      OR COALESCE(char_length(btrim(p_partner_evidence_reference)), 0) NOT BETWEEN 1 AND 1024
    ))
    OR EXISTS (SELECT 1 FROM private.brilstash_released_attempts a
      WHERE a.installation_id = installation.id AND a.resolved_at IS NULL)
  THEN RAISE EXCEPTION 'BrilStash installation cannot retire before partner disposition' USING ERRCODE = '23514'; END IF;

  retirement_time := clock_timestamp();
  UPDATE private.brilstash_credentials SET revoked_at = retirement_time
    WHERE installation_id = installation.id AND revoked_at IS NULL;
  DELETE FROM private.brilstash_builder_entitlements WHERE installation_id = installation.id;
  UPDATE private.brilstash_drains SET outcome = 'aborted', completed_at = retirement_time
    WHERE installation_id = installation.id AND outcome IS NULL;

  INSERT INTO private.brilstash_installation_retirements (
    installation_id, reason, partner_evidence_reference, retired_by, retired_at
  ) VALUES (installation.id, p_reason, p_partner_evidence_reference, auth.uid(), retirement_time);
  UPDATE private.brilstash_installations
  SET admission = 'suspended', retired_at = retirement_time, intended_credential_id = NULL,
    catalogue_revision = catalogue_revision + 1, serving_revision = serving_revision + 1,
    credential_revision = credential_revision + 1
  WHERE id = installation.id;
END;
$$;

REVOKE ALL ON FUNCTION public.retire_brilstash_installation(uuid, bigint, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retire_brilstash_installation(uuid, bigint, text, text) TO authenticated;
