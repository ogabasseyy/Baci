CREATE OR REPLACE FUNCTION public.require_piggyvest_transfer_outbox_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF session_user NOT IN (
    'piggyvest_staging_ledger_worker',
    'piggyvest_staging_submission_writer'
  ) THEN
    RAISE EXCEPTION 'piggyvest transfer outbox finality requires its restricted worker';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'piggyvest transfer outbox finality requires read committed';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_piggyvest_scoped_transfer_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  outbox_owner text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(outbox.relowner)
  INTO outbox_owner
  FROM pg_catalog.pg_class AS outbox
  WHERE outbox.oid = 'public.piggyvest_transfer_outbox'::regclass;

  IF TG_OP = 'INSERT' THEN
    IF NEW.currency IS NULL THEN
      RETURN NEW;
    END IF;
    IF session_user NOT IN (
      'piggyvest_staging_ledger_worker',
      'piggyvest_staging_submission_writer',
      outbox_owner
    ) THEN
      RAISE EXCEPTION 'scoped PiggyVest transfer outbox rows require the restricted worker or table owner';
    END IF;
    IF NEW.status <> 'submitted' OR NEW.provider_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'scoped PiggyVest transfer outbox rows must begin submitted';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.currency IS NULL AND NEW.currency IS NULL THEN
    RETURN NEW;
  END IF;
  IF session_user NOT IN (
    'piggyvest_staging_ledger_worker',
    'piggyvest_staging_submission_writer',
    outbox_owner
  ) THEN
    RAISE EXCEPTION 'scoped PiggyVest transfer outbox rows require the restricted worker or table owner';
  END IF;
  IF OLD.currency IS NULL THEN
    IF NEW.status <> 'submitted' OR NEW.provider_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'scoped PiggyVest transfer outbox rows must begin submitted';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.reference IS DISTINCT FROM OLD.reference
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
    OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
    OR NEW.amount_kobo IS DISTINCT FROM OLD.amount_kobo
    OR NEW.direction IS DISTINCT FROM OLD.direction
    OR NEW.destination_ref IS DISTINCT FROM OLD.destination_ref
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.source_wallet_id IS DISTINCT FROM OLD.source_wallet_id
    OR NEW.provider_customer_id IS DISTINCT FROM OLD.provider_customer_id
    OR NEW.business_id IS DISTINCT FROM OLD.business_id
    OR NEW.integration_id IS DISTINCT FROM OLD.integration_id
    OR OLD.status <> 'submitted'
    OR OLD.provider_transaction_id IS NOT NULL
    OR NEW.status NOT IN ('succeeded', 'failed')
    OR NEW.provider_transaction_id IS NULL THEN
    RAISE EXCEPTION 'scoped PiggyVest transfer outbox terminal mutation refused';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'piggyvest_staging_submission_writer'
  ) THEN
    REVOKE ALL ON FUNCTION public.read_piggyvest_transfer_outbox_finality(text, text, text, text, text) FROM piggyvest_staging_submission_writer;
    REVOKE ALL ON FUNCTION public.apply_piggyvest_transfer_outbox_finality(text, text, bigint, text, text, text, text, text, text, text, text, text) FROM piggyvest_staging_submission_writer;
    REVOKE ALL ON TABLE public.piggyvest_transfer_outbox FROM piggyvest_staging_submission_writer;
  END IF;
END;
$$;
