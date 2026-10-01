-- Version active aliases when their payable balance changes so an in-flight
-- transfer keeps its original snapshot. Also retain explicitly supplied invoice
-- terms instead of truncating them to ninety minutes.

CREATE OR REPLACE FUNCTION public.clamp_paystack_order_alias_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bound_authenticated_paystack_alias_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.provider = 'paystack'
    AND COALESCE(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'UPDATE' AND OLD.provider = 'paystack_version' THEN
      RETURN NEW;
    END IF;
    -- Existing assignments may be expired when an authenticated lifecycle
    -- update shortens their expiry (for example, after cancellation or an
    -- email change). Do not re-apply the assignment freshness window to that
    -- update, but never allow it to extend beyond the row's current effective
    -- reservation window.
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
      OR NEW.expires_at > NEW.assigned_at + interval '90 minutes' THEN
      RAISE EXCEPTION 'invalid authenticated Paystack alias timestamps';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.version_active_paystack_alias_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version_id uuid;
BEGIN
  IF OLD.provider <> 'paystack'
    OR NEW.payable_amount IS NOT DISTINCT FROM OLD.payable_amount
    OR COALESCE(
      OLD.expires_at,
      OLD.assigned_at + interval '90 minutes',
      OLD.created_at + interval '90 minutes'
    ) <= now() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || trim(OLD.account_number), 0
    )
  );

  INSERT INTO public.order_payment_accounts (
    order_id, account_number, bank_name, account_name, provider,
    payable_amount, assigned_at, expires_at, assignment_customer_email,
    assignment_customer_email_source
  ) VALUES (
    OLD.order_id, OLD.account_number, OLD.bank_name, OLD.account_name,
    'paystack_version', NEW.payable_amount, now(), OLD.expires_at,
    OLD.assignment_customer_email, OLD.assignment_customer_email_source
  ) RETURNING id INTO v_version_id;

  UPDATE public.order_payment_accounts
  SET provider = 'paystack'
  WHERE id = v_version_id;

  NEW.payable_amount := OLD.payable_amount;
  NEW.assignment_customer_email := OLD.assignment_customer_email;
  NEW.expires_at := LEAST(COALESCE(NEW.expires_at, now()), now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS e_version_active_paystack_alias_snapshot
  ON public.order_payment_accounts;
CREATE TRIGGER e_version_active_paystack_alias_snapshot
  BEFORE UPDATE OF payable_amount ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.version_active_paystack_alias_snapshot();

DROP TRIGGER IF EXISTS b_bound_authenticated_paystack_alias_timestamps
  ON public.order_payment_accounts;
CREATE TRIGGER b_bound_authenticated_paystack_alias_timestamps
  BEFORE INSERT OR UPDATE OF provider, assigned_at, expires_at
  ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.bound_authenticated_paystack_alias_timestamps();

REVOKE ALL ON FUNCTION public.version_active_paystack_alias_snapshot()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bound_authenticated_paystack_alias_timestamps()
  FROM PUBLIC;
