ALTER TABLE public.piggyvest_transfer_outbox
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS source_wallet_id text,
  ADD COLUMN IF NOT EXISTS provider_customer_id text,
  ADD COLUMN IF NOT EXISTS business_id text,
  ADD COLUMN IF NOT EXISTS integration_id text,
  ADD COLUMN IF NOT EXISTS provider_transaction_id text;

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
      currency = 'NGN'
      AND source_wallet_id IS NOT NULL
      AND provider_customer_id IS NOT NULL
      AND business_id IS NOT NULL
      AND integration_id IS NOT NULL
    )
  );

ALTER TABLE public.piggyvest_transfer_outbox
  DROP CONSTRAINT IF EXISTS piggyvest_transfer_outbox_provider_transaction_check;

ALTER TABLE public.piggyvest_transfer_outbox
  ADD CONSTRAINT piggyvest_transfer_outbox_provider_transaction_check CHECK (
    provider_transaction_id IS NULL
    OR length(btrim(provider_transaction_id)) > 0
  );

CREATE UNIQUE INDEX IF NOT EXISTS piggyvest_transfer_outbox_provider_transaction_scope_idx
  ON public.piggyvest_transfer_outbox (
    business_id,
    integration_id,
    provider_transaction_id
  )
  WHERE provider_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.require_piggyvest_transfer_outbox_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF session_user <> 'piggyvest_staging_ledger_worker' THEN
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
BEGIN
  IF OLD.currency IS NULL THEN
    RETURN NEW;
  END IF;
  IF session_user <> 'piggyvest_staging_ledger_worker' THEN
    RAISE EXCEPTION 'scoped PiggyVest transfer outbox rows require the restricted worker';
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
BEFORE UPDATE ON public.piggyvest_transfer_outbox
FOR EACH ROW
EXECUTE FUNCTION public.protect_piggyvest_scoped_transfer_outbox();

CREATE OR REPLACE FUNCTION public.require_piggyvest_transfer_outbox_system(
  p_expected_system_identifier text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_expected_system_identifier IS NULL
    OR p_expected_system_identifier !~ '^[0-9]{1,20}$'
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
      <> p_expected_system_identifier THEN
    RAISE EXCEPTION 'piggyvest transfer outbox finality target refused';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_piggyvest_transfer_outbox_finality(
  p_expected_system_identifier text,
  p_reference text,
  p_provider_customer_id text,
  p_business_id text,
  p_integration_id text
)
RETURNS TABLE (
  reference text,
  amount_kobo bigint,
  currency text,
  source_wallet_id text,
  destination_ref text,
  direction text,
  provider_customer_id text,
  business_id text,
  integration_id text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.require_piggyvest_transfer_outbox_worker();
  PERFORM public.require_piggyvest_transfer_outbox_system(
    p_expected_system_identifier
  );

  RETURN QUERY
  SELECT
    outbox.reference,
    outbox.amount_kobo,
    outbox.currency,
    outbox.source_wallet_id,
    outbox.destination_ref,
    outbox.direction,
    outbox.provider_customer_id,
    outbox.business_id,
    outbox.integration_id,
    outbox.status
  FROM public.piggyvest_transfer_outbox AS outbox
  WHERE outbox.reference = p_reference
    AND outbox.provider_customer_id = p_provider_customer_id
    AND outbox.business_id = p_business_id
    AND outbox.integration_id = p_integration_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_piggyvest_transfer_outbox_finality(
  p_expected_system_identifier text,
  p_reference text,
  p_amount_kobo bigint,
  p_currency text,
  p_source_wallet_id text,
  p_destination_ref text,
  p_direction text,
  p_provider_customer_id text,
  p_business_id text,
  p_integration_id text,
  p_provider_transaction_id text,
  p_terminal_status text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_status text;
BEGIN
  PERFORM public.require_piggyvest_transfer_outbox_worker();
  PERFORM public.require_piggyvest_transfer_outbox_system(
    p_expected_system_identifier
  );

  IF p_terminal_status IS NULL OR p_terminal_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'invalid PiggyVest transfer terminal status';
  END IF;
  IF p_provider_transaction_id IS NULL
    OR length(btrim(p_provider_transaction_id)) = 0 THEN
    RAISE EXCEPTION 'missing PiggyVest provider transaction identity';
  END IF;

  UPDATE public.piggyvest_transfer_outbox AS outbox
  SET status = p_terminal_status,
      provider_transaction_id = p_provider_transaction_id,
      updated_at = now()
  WHERE outbox.reference = p_reference
    AND outbox.amount_kobo = p_amount_kobo
    AND outbox.currency = p_currency
    AND outbox.source_wallet_id = p_source_wallet_id
    AND outbox.destination_ref = p_destination_ref
    AND outbox.direction = p_direction
    AND outbox.provider_customer_id = p_provider_customer_id
    AND outbox.business_id = p_business_id
    AND outbox.integration_id = p_integration_id
    AND outbox.provider_transaction_id IS NULL
    AND outbox.status = 'submitted'
  RETURNING outbox.status INTO existing_status;

  IF FOUND THEN
    RETURN 'applied';
  END IF;

  SELECT outbox.status INTO existing_status
  FROM public.piggyvest_transfer_outbox AS outbox
  WHERE outbox.reference = p_reference
    AND outbox.amount_kobo = p_amount_kobo
    AND outbox.currency = p_currency
    AND outbox.source_wallet_id = p_source_wallet_id
    AND outbox.destination_ref = p_destination_ref
    AND outbox.direction = p_direction
    AND outbox.provider_customer_id = p_provider_customer_id
    AND outbox.business_id = p_business_id
    AND outbox.integration_id = p_integration_id;

  IF NOT FOUND THEN
    RETURN 'not-submitted';
  END IF;
  IF existing_status = p_terminal_status AND EXISTS (
    SELECT 1
    FROM public.piggyvest_transfer_outbox AS outbox
    WHERE outbox.reference = p_reference
      AND outbox.amount_kobo = p_amount_kobo
      AND outbox.currency = p_currency
      AND outbox.source_wallet_id = p_source_wallet_id
      AND outbox.destination_ref = p_destination_ref
      AND outbox.direction = p_direction
      AND outbox.provider_customer_id = p_provider_customer_id
      AND outbox.business_id = p_business_id
      AND outbox.integration_id = p_integration_id
      AND outbox.provider_transaction_id = p_provider_transaction_id
  ) THEN
    RETURN 'duplicate';
  END IF;
  RETURN 'terminal-conflict';
END;
$$;

REVOKE ALL ON FUNCTION public.require_piggyvest_transfer_outbox_worker() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_piggyvest_transfer_outbox_system(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_piggyvest_scoped_transfer_outbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_piggyvest_transfer_outbox_finality(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_piggyvest_transfer_outbox_finality(text, text, bigint, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
