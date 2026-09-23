-- Authenticated delegation for the repair-booking wrapper without widening
-- private-schema lookup: the public wrapper is SECURITY INVOKER (anon
-- hardening), but the delegates boundary revokes private-schema USAGE from
-- browser roles, so direct RPC bookings fail with PostgreSQL 42501 for anon
-- and authenticated callers. Reverting the wrapper to DEFINER would undo the
-- anon hardening, and granting USAGE to authenticated would break the
-- delegates boundary enforced by
-- order-private-schema-usage-migration.test.ts. Instead, resolve the private
-- call through a narrowly scoped PUBLIC trampoline owned by the migrator:
-- callers need only EXECUTE on public objects (already granted), and the
-- trampoline executes the private implementation as its owner. Lookup on the
-- private schema stays revoked for browser roles, and execution stays
-- governed by the explicit per-function EXECUTE grants.

-- Undo the authenticated half of ...801, whose USAGE grant conflicted with
-- the delegates boundary. The anon/service_role halves were no-ops (usage
-- predates this branch) and are left untouched.
REVOKE USAGE ON SCHEMA private FROM authenticated;

CREATE OR REPLACE FUNCTION public.create_repair_booking_as_owner(
  p_merchant_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_device_type text,
  p_device_model text,
  p_issue_description text,
  p_preferred_date timestamptz,
  p_service_type text,
  p_pickup_address text,
  p_device_id uuid,
  p_quote_id uuid
)
RETURNS TABLE (booking_id uuid, ticket_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT booking.booking_id, booking.ticket_number
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
  ) AS booking(booking_id uuid, ticket_number integer);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_repair_booking_as_owner(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_repair_booking_as_owner(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid) TO anon, authenticated, service_role;
ALTER FUNCTION public.create_repair_booking_as_owner(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid) OWNER TO postgres;
COMMENT ON FUNCTION public.create_repair_booking_as_owner(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid) IS 'Definer trampoline letting the invoker booking wrapper reach the private implementation without private-schema USAGE for browser roles.';

-- Re-point the invoker wrapper at the trampoline; the wrapper keeps its
-- invoker posture, pinned search_path, and public grants.
CREATE OR REPLACE FUNCTION public.create_repair_booking(
  p_merchant_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_device_type text,
  p_device_model text,
  p_issue_description text,
  p_preferred_date timestamptz,
  p_service_type text,
  p_pickup_address text,
  p_device_id uuid,
  p_quote_id uuid
)
RETURNS TABLE (booking_id uuid, ticket_number integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT booking.booking_id, booking.ticket_number
  FROM public.create_repair_booking_as_owner(
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
  ) AS booking(booking_id uuid, ticket_number integer);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_repair_booking(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_repair_booking(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid) TO anon, authenticated, service_role;
ALTER FUNCTION public.create_repair_booking(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid) OWNER TO postgres;
COMMENT ON FUNCTION public.create_repair_booking(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid) IS 'SECURITY INVOKER booking entry point delegating to the owner trampoline; direct REST callers are privilege-checked as themselves.';
