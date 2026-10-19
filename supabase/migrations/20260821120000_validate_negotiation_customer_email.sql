-- Extend negotiation contact enforcement without rewriting the earlier migration.
CREATE OR REPLACE FUNCTION private.enforce_negotiation_customer_contact_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.customer_email IS DISTINCT FROM OLD.customer_email)
    AND NEW.customer_email IS NOT NULL
    AND (
      NEW.customer_email <> lower(btrim(NEW.customer_email))
      OR length(NEW.customer_email) > 254
      OR NEW.customer_email
        !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    )
  THEN
    RAISE EXCEPTION 'invalid_negotiation_customer_email'
      USING ERRCODE = '23514',
        CONSTRAINT = 'negotiation_requests_customer_email_format_check';
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone)
    AND NEW.customer_phone IS NOT NULL
    AND (
      NEW.customer_phone <> btrim(NEW.customer_phone)
      OR NEW.customer_phone !~ '^[1-9][0-9]{7,14}$'
    )
  THEN
    RAISE EXCEPTION 'invalid_negotiation_customer_phone'
      USING ERRCODE = '23514',
        CONSTRAINT = 'negotiation_requests_customer_phone_e164_check';
  END IF;

  IF NEW.customer_email IS NULL AND NEW.customer_phone IS NULL THEN
    RAISE EXCEPTION 'negotiation_customer_contact_required'
      USING ERRCODE = '23514',
        CONSTRAINT = 'negotiation_requests_customer_contact_required';
  END IF;

  RETURN NEW;
END;
$$;
