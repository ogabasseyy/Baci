CREATE TABLE private.brilstash_suspensions (
  installation_id uuid NOT NULL REFERENCES private.brilstash_installations(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  prior_generation_id uuid,
  catalogue_revision bigint NOT NULL CHECK (catalogue_revision > 0),
  suspended_by uuid NOT NULL,
  suspended_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1024),
  PRIMARY KEY (installation_id, id),
  UNIQUE (installation_id, catalogue_revision),
  FOREIGN KEY (installation_id, prior_generation_id)
    REFERENCES private.brilstash_generations(installation_id, id)
);

CREATE INDEX brilstash_suspensions_prior_generation_idx
  ON private.brilstash_suspensions (installation_id, prior_generation_id);

ALTER TABLE private.brilstash_suspensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY brilstash_no_direct_access ON private.brilstash_suspensions
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.brilstash_suspensions FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.suspend_brilstash_installation(p_installation_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE suspension_id uuid;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF installation.activated_at IS NULL THEN
    RAISE EXCEPTION 'BrilStash installation is not active' USING ERRCODE = '23514';
  END IF;

  -- Keep the old pointer for audit. Closure and the revision changes make
  -- the old generation unavailable and prevent a staged candidate reopening it.
  INSERT INTO private.brilstash_suspensions (
    installation_id, prior_generation_id, catalogue_revision, suspended_by, reason
  ) VALUES (
    installation.id, installation.active_generation_id, installation.catalogue_revision + 1,
    auth.uid(), p_reason
  ) RETURNING id INTO suspension_id;

  UPDATE private.brilstash_installations SET admission = 'suspended',
    catalogue_revision = catalogue_revision + 1, serving_revision = serving_revision + 1
  WHERE id = installation.id;
  RETURN suspension_id;
END;
$$;

REVOKE ALL ON FUNCTION public.suspend_brilstash_installation(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suspend_brilstash_installation(uuid, text) TO authenticated;
