-- Prevent stale or hostile storefront clients from creating negotiations that
-- merchants cannot follow up. Existing contactless rows remain updateable so
-- merchants can still resolve historical requests.

CREATE OR REPLACE FUNCTION private.enforce_negotiation_customer_contact_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.customer_phone IS NOT NULL
    AND (
      NEW.customer_phone <> btrim(NEW.customer_phone)
      OR NEW.customer_phone !~ '^[1-9][0-9]{7,14}$'
    )
  THEN
    RAISE EXCEPTION 'invalid_negotiation_customer_phone'
      USING ERRCODE = '23514',
        CONSTRAINT = 'negotiation_requests_customer_phone_format_check';
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.customer_email, '')), '') IS NULL
    AND NULLIF(btrim(COALESCE(NEW.customer_phone, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'negotiation_customer_contact_required'
      USING ERRCODE = '23514',
        CONSTRAINT = 'negotiation_requests_customer_contact_required';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_negotiation_customer_contact_v1()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_negotiation_customer_contact
  ON public.negotiation_requests;

CREATE TRIGGER enforce_negotiation_customer_contact
BEFORE INSERT OR UPDATE OF customer_email, customer_phone
ON public.negotiation_requests
FOR EACH ROW
EXECUTE FUNCTION private.enforce_negotiation_customer_contact_v1();

DROP POLICY IF EXISTS "Customers can create negotiation requests"
  ON public.negotiation_requests;
DROP POLICY IF EXISTS "Guests can create reachable negotiation requests"
  ON public.negotiation_requests;
DROP POLICY IF EXISTS "Customers can create reachable negotiation requests"
  ON public.negotiation_requests;

CREATE POLICY "Guests can create reachable negotiation requests"
  ON public.negotiation_requests
  AS PERMISSIVE
  FOR INSERT
  TO anon
  WITH CHECK (
    customer_id IS NULL
    AND NULLIF(btrim(session_id), '') IS NOT NULL
  );

CREATE POLICY "Customers can create reachable negotiation requests"
  ON public.negotiation_requests
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    NULLIF(btrim(session_id), '') IS NOT NULL
    AND (
      customer_id IS NULL
      OR customer_id = (SELECT auth.uid())
    )
  );

COMMENT ON FUNCTION private.enforce_negotiation_customer_contact_v1() IS
  'Requires every new negotiation to retain a normalized phone or valid email; contact-field updates are checked while legacy status-only updates remain possible.';
