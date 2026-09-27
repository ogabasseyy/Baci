CREATE OR REPLACE FUNCTION private.validate_redvault_commercial_terms()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  terms jsonb;
  dates jsonb;
  caps jsonb;
  minimum_spend_kobo bigint;
  discount_cap_kobo bigint;
  starts_at timestamptz;
  ends_at timestamptz;
BEGIN
  SELECT commercial_terms INTO terms
  FROM private.uba_redvault_runtime
  WHERE partnership = 'uba_redvault' AND commercial_terms_confirmed;
  IF jsonb_typeof(terms) IS DISTINCT FROM 'object'
    OR jsonb_typeof(terms->'campaign_dates') IS DISTINCT FROM 'object'
    OR jsonb_typeof(terms->'minimum_spend') IS DISTINCT FROM 'object'
    OR jsonb_typeof(terms->'caps') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'redvault_commercial_terms_unconfirmed';
  END IF;
  IF NOT (terms->'campaign_dates' ?& ARRAY['starts_at', 'ends_at'])
    OR jsonb_typeof(terms->'campaign_dates'->'starts_at') IS DISTINCT FROM 'string'
    OR jsonb_typeof(terms->'campaign_dates'->'ends_at') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'redvault_campaign_dates_invalid';
  END IF;
  BEGIN
    starts_at := (terms->'campaign_dates'->>'starts_at')::timestamptz;
    ends_at := (terms->'campaign_dates'->>'ends_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'redvault_campaign_dates_invalid';
  END;
  IF starts_at >= ends_at OR now() < starts_at OR now() >= ends_at THEN
    RAISE EXCEPTION 'redvault_campaign_inactive';
  END IF;
  IF NOT (terms->'minimum_spend' ? 'eligible_subtotal_kobo')
    OR jsonb_typeof(terms->'minimum_spend'->'eligible_subtotal_kobo') IS DISTINCT FROM 'number'
    OR (terms->'minimum_spend'->>'eligible_subtotal_kobo') !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION 'redvault_minimum_spend_invalid';
  END IF;
  minimum_spend_kobo := (terms->'minimum_spend'->>'eligible_subtotal_kobo')::bigint;
  IF NEW.eligible_subtotal_kobo < minimum_spend_kobo THEN
    RAISE EXCEPTION 'redvault_minimum_spend_not_met';
  END IF;
  caps := terms->'caps';
  IF NOT (caps ? 'discount_kobo')
    OR jsonb_typeof(caps->'discount_kobo') IS DISTINCT FROM 'number'
    OR (caps->>'discount_kobo') !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION 'redvault_discount_cap_invalid';
  END IF;
  discount_cap_kobo := (caps->>'discount_kobo')::bigint;
  IF NEW.discount_kobo > discount_cap_kobo THEN
    RAISE EXCEPTION 'redvault_discount_cap_exceeded';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.validate_redvault_commercial_terms() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.validate_redvault_commercial_terms() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS validate_redvault_commercial_terms ON private.uba_redvault_applications;
CREATE TRIGGER validate_redvault_commercial_terms
  BEFORE INSERT ON private.uba_redvault_applications
  FOR EACH ROW EXECUTE FUNCTION private.validate_redvault_commercial_terms();
