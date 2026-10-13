-- Keep the amount and customer identity advertised during each assignment
-- immutable after expiry so delayed webhooks can match historical aliases.

ALTER TABLE public.order_payment_accounts
  ADD COLUMN IF NOT EXISTS assignment_customer_email text;

ALTER TABLE public.order_payment_accounts
  ADD COLUMN IF NOT EXISTS assignment_customer_email_source text;

UPDATE public.order_payment_accounts AS account
SET assignment_customer_email = lower(trim(orders.customer_email))
FROM public.orders AS orders
WHERE orders.id = account.order_id
  AND account.provider = 'paystack'
  AND account.assignment_customer_email IS NULL;

-- Record which rows were present for the one-time backfill. This provenance
-- marker lets a later cleanup remove only these unverifiable values without
-- relying on nullable created_at values or a wall-clock cutoff.
UPDATE public.order_payment_accounts AS account
SET assignment_customer_email_source = 'legacy_backfill'
WHERE account.provider = 'paystack'
  AND account.assignment_customer_email_source IS NULL;

CREATE OR REPLACE FUNCTION public.snapshot_paystack_order_alias_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.provider <> 'paystack' THEN
    RETURN NEW;
  END IF;
  IF NEW.assignment_customer_email IS NOT NULL THEN
    IF NEW.assignment_customer_email_source IS NULL THEN
      NEW.assignment_customer_email_source := 'provided';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || NEW.order_id::text, 0)
  );
  SELECT lower(trim(orders.customer_email))
  INTO NEW.assignment_customer_email
  FROM public.orders AS orders
  WHERE orders.id = NEW.order_id;
  NEW.assignment_customer_email_source := 'assignment';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.freeze_expired_paystack_alias_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.provider = 'paystack'
    AND COALESCE(
      OLD.expires_at,
      OLD.assigned_at + interval '90 minutes',
      OLD.created_at + interval '90 minutes'
    ) <= now() THEN
    NEW.payable_amount := OLD.payable_amount;
    NEW.assignment_customer_email := OLD.assignment_customer_email;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_snapshot_paystack_order_alias_email
  ON public.order_payment_accounts;
CREATE TRIGGER a_snapshot_paystack_order_alias_email
  BEFORE INSERT ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_paystack_order_alias_email();

DROP TRIGGER IF EXISTS freeze_expired_paystack_alias_snapshot
  ON public.order_payment_accounts;
CREATE TRIGGER freeze_expired_paystack_alias_snapshot
  BEFORE UPDATE OF payable_amount, assignment_customer_email
  ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.freeze_expired_paystack_alias_snapshot();

REVOKE ALL ON FUNCTION public.snapshot_paystack_order_alias_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.freeze_expired_paystack_alias_snapshot() FROM PUBLIC;
