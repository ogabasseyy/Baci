-- The snapshot migration populated assignment_customer_email for existing
-- aliases from the order's current email. Those values cannot prove the email
-- used when the Paystack assignment was created, so do not let them drive
-- delayed webhook matching. New rows continue to be captured by the insert
-- trigger with an assignment-time value.
--
-- The cleanup uses provenance recorded by the snapshot migration rather than
-- a filename timestamp: this also covers rows with nullable created_at and
-- deployments that apply the migration later than its filename suggests.

CREATE OR REPLACE FUNCTION public.freeze_expired_paystack_alias_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Only the one-time legacy-email cleanup may clear an untrusted historical
  -- snapshot. Backend refreshes, including service-role checkout paths, still
  -- preserve immutable fields on expired assignments.
  IF pg_catalog.current_setting(
    'baci.paystack_alias_email_cleanup', true
  ) = 'on' THEN
    RETURN NEW;
  END IF;

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

SELECT pg_catalog.set_config(
  'baci.paystack_alias_email_cleanup', 'on', true
);

UPDATE public.order_payment_accounts AS account
SET assignment_customer_email = NULL,
    assignment_customer_email_source = 'legacy_untrusted',
    expires_at = LEAST(COALESCE(account.expires_at, now()), now())
WHERE account.provider = 'paystack'
  AND account.assignment_customer_email_source = 'legacy_backfill';

SELECT pg_catalog.set_config(
  'baci.paystack_alias_email_cleanup', 'off', true
);

REVOKE ALL ON FUNCTION public.freeze_expired_paystack_alias_snapshot()
  FROM PUBLIC;
