-- Keep authenticated timestamp binding separate from the reservation and payable
-- function repairs.

CREATE OR REPLACE FUNCTION public.bound_authenticated_paystack_alias_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_internal_verified boolean :=
    COALESCE(
      pg_catalog.current_setting(
        'baci.paystack_dva_reservation_verified', true
      ),
      ''
    ) = 'on';
BEGIN
  IF NEW.provider = 'paystack'
    AND COALESCE(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'UPDATE' AND OLD.provider = 'paystack_version' THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
      AND OLD.provider = 'paystack'
      AND NEW.provider = 'paystack'
      AND NEW.assigned_at IS NOT DISTINCT FROM OLD.assigned_at
      AND NEW.expires_at IS NOT NULL
      AND NEW.expires_at <= COALESCE(
        OLD.expires_at,
        OLD.assigned_at + interval '90 minutes',
        OLD.created_at + interval '90 minutes'
      ) THEN
      RETURN NEW;
    END IF;
    IF NEW.assigned_at IS NULL
      OR NEW.expires_at IS NULL
      OR NEW.assigned_at < now() - interval '5 minutes'
      OR NEW.assigned_at > now() + interval '5 minutes'
      OR NEW.expires_at <= NEW.assigned_at
      OR (
        NOT v_internal_verified
        AND NEW.expires_at > NEW.assigned_at + interval '90 minutes'
      ) THEN
      RAISE EXCEPTION 'invalid authenticated Paystack alias timestamps';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
