-- Enforce the public repair-booking wrapper contract: SECURITY INVOKER with
-- a pinned empty search_path and EXECUTE for anon, authenticated, and
-- service_role only. The wrapper must stay INVOKER so direct REST calls are
-- privilege-checked against the caller instead of executing as the owner.
-- Replaces public.create_repair_booking with the enforced definition; the
-- private booking implementation is untouched.

CREATE OR REPLACE FUNCTION public.create_repair_booking(
  p_merchant_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_device_type text,
  p_device_model text,
  p_issue_description text,
  p_preferred_date timestamptz DEFAULT NULL,
  p_service_type text DEFAULT 'dropoff',
  p_pickup_address text DEFAULT NULL,
  p_device_id uuid DEFAULT NULL,
  p_quote_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, ticket_number integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT booking.id, booking.ticket_number
  FROM private.create_repair_booking(
    p_merchant_id,
    p_customer_name,
    p_customer_email,
    p_customer_phone,
    p_device_type,
    p_device_model,
    p_issue_description,
    p_preferred_date,
    p_service_type,
    p_pickup_address,
    p_device_id,
    p_quote_id
  ) AS booking;
END;
$$;

-- Re-assert the locked-down grants (CREATE OR REPLACE preserves ACLs; explicit
-- here for clarity and idempotency).
REVOKE ALL ON FUNCTION public.create_repair_booking(
  uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_repair_booking(
  uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid
) TO anon, authenticated, service_role;
