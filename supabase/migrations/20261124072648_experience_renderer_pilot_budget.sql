-- Cap retained JSON bytes across all pilot attempts, including failed builds.
-- Serialize initialization with renderer writes so existing rows are counted once.
LOCK TABLE experience_authorization.verified_renderers IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE experience_authorization.renderer_pilot_budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  used_bytes bigint NOT NULL CHECK (used_bytes >= 0),
  max_bytes bigint NOT NULL CHECK (max_bytes > 0)
);
ALTER TABLE experience_authorization.renderer_pilot_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.renderer_pilot_budget
  FROM PUBLIC, anon, authenticated, service_role, baci_experience_verifier, baci_experience_renderer_reader;

INSERT INTO experience_authorization.renderer_pilot_budget (used_bytes, max_bytes)
SELECT COALESCE(sum(octet_length(renderer::text)), 0), 268435456
FROM experience_authorization.verified_renderers;

-- Only this insert trigger may charge the private ledger. The conditional row
-- update arbitrates concurrent writers, and failure rolls back the evidence too.
CREATE FUNCTION experience_authorization.charge_renderer_pilot_budget()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  renderer_bytes integer := octet_length(NEW.renderer::text);
BEGIN
  UPDATE experience_authorization.renderer_pilot_budget
  SET used_bytes = used_bytes + renderer_bytes
  WHERE singleton AND used_bytes <= max_bytes - renderer_bytes;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RENDERER_STORAGE_LIMIT' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION experience_authorization.charge_renderer_pilot_budget()
  FROM PUBLIC, anon, authenticated, service_role, baci_experience_verifier, baci_experience_renderer_reader;

CREATE TRIGGER charge_renderer_pilot_budget
AFTER INSERT ON experience_authorization.verified_renderers
FOR EACH ROW EXECUTE FUNCTION experience_authorization.charge_renderer_pilot_budget();
