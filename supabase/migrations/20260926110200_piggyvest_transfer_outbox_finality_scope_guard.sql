ALTER TABLE public.piggyvest_transfer_outbox
  DROP CONSTRAINT IF EXISTS piggyvest_transfer_outbox_finality_identity_check;

ALTER TABLE public.piggyvest_transfer_outbox
  ADD CONSTRAINT piggyvest_transfer_outbox_finality_identity_check CHECK (
    (
      currency IS NULL
      AND source_wallet_id IS NULL
      AND provider_customer_id IS NULL
      AND business_id IS NULL
      AND integration_id IS NULL
    )
    OR (
      currency IS NOT NULL
      AND currency = 'NGN'
      AND reference IS NOT NULL
      AND destination_ref IS NOT NULL
      AND source_wallet_id IS NOT NULL
      AND provider_customer_id IS NOT NULL
      AND business_id IS NOT NULL
      AND integration_id IS NOT NULL
      AND length(btrim(reference)) > 0
      AND length(btrim(destination_ref)) > 0
      AND length(btrim(source_wallet_id)) > 0
      AND length(btrim(provider_customer_id)) > 0
      AND length(btrim(business_id)) > 0
      AND length(btrim(integration_id)) > 0
    )
  );

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
    IF session_user <> 'piggyvest_staging_ledger_worker'
      AND session_user <> outbox_owner THEN
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
  IF session_user <> 'piggyvest_staging_ledger_worker'
    AND session_user <> outbox_owner THEN
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

DROP TRIGGER IF EXISTS protect_piggyvest_scoped_transfer_outbox
  ON public.piggyvest_transfer_outbox;

CREATE TRIGGER protect_piggyvest_scoped_transfer_outbox
BEFORE INSERT OR UPDATE ON public.piggyvest_transfer_outbox
FOR EACH ROW
EXECUTE FUNCTION public.protect_piggyvest_scoped_transfer_outbox();

REVOKE ALL ON FUNCTION public.protect_piggyvest_scoped_transfer_outbox() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.protect_piggyvest_scoped_transfer_outbox() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.protect_piggyvest_scoped_transfer_outbox() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.protect_piggyvest_scoped_transfer_outbox() FROM service_role;
  END IF;
END;
$$;
