-- PiggyVest credit identity = pvb_reference (contract answer, 2026-11-11).
--
-- PiggyVest's engineer confirmed in the shared group that the unique key for
-- a credit is the envelope `pvb_reference` (the PVB credit id, `PVB01…`).
-- `eventData.transaction_id` (inflows) and `eventData.id` (interest payouts)
-- are PVB-internal and are not the credit's identity. This migration makes
-- `pvb_reference` the dedupe key of both credit ledgers:
--
-- * New nullable `pvb_reference` column on each ledger. Rows written before
--   this migration are backfilled from the webhook inbox, whose `reference`
--   column has always stored the envelope `pvb_reference` for these two
--   event types. A row whose inbox evidence is gone, or whose backfilled
--   value would collide with another row, keeps NULL (a legacy row) rather
--   than block the deploy or guess.
-- * A UNIQUE constraint on `pvb_reference` (NULLs stay distinct, so legacy
--   rows are allowed). New writes through the intake functions require it.
-- * The old provider keys stay as the primary keys, now audit columns: a
--   second distinct pvb_reference that reuses an internal id still cannot
--   insert, and the app quarantines it as a conflict instead of crediting
--   or silently acking it.
-- * Fail closed on unresolved legacy rows, scoped to the customer. A
--   NULL-reference row collides with nothing on pvb_reference, so a
--   redelivery of that same credit carrying a different internal id would
--   insert a second credit. A credit's envelope customer_id never changes,
--   so while such a row exists for a customer, the insert functions refuse
--   that customer's new credits with a retryable 55000 (the receiver
--   answers 503 / the capture drain retries) until an operator sets the
--   legacy row's pvb_reference from verified evidence. Other customers are
--   unaffected, and a redelivery carrying an internal id that is already
--   stored (the legacy credit itself) is exempt: it reaches ON CONFLICT and
--   the app's duplicate path instead of 503-looping.
--   This deliberately does not abort the migration: a deploy-blocking
--   migration would hold every other release hostage to a data repair.
-- * Insert functions use a target-less ON CONFLICT DO NOTHING so a collision
--   on either key reports "[]" (duplicate path) instead of raising 23505.
-- * Read functions accept either key and return both, so the app can find
--   a credit by pvb_reference and fall back to the legacy key for
--   pre-migration rows.

BEGIN;

ALTER TABLE public.piggyvest_inflow_credits
  ADD COLUMN IF NOT EXISTS pvb_reference text;
ALTER TABLE public.piggyvest_interest_payouts
  ADD COLUMN IF NOT EXISTS pvb_reference text;

-- Evidence-only repair, run once here and re-runnable by an operator (as the
-- migration owner) after inbox evidence is restored. Not exposed to any API
-- role. It never guesses and never overwrites a non-null value:
-- 1. Interest inbox rows recorded before this change stored the PVB-internal
--    eventData.destination_wallet as wallet_id. The inbox treats a
--    redelivery whose wallet differs from the stored row as an event-id
--    conflict, so the identical signed payout (now attributed to pvb_wallet)
--    would be quarantined instead of reaching the corrected ledger. Rows are
--    re-attributed from their own stored, redacted event details: only rows
--    whose wallet_id is exactly the stored destination_wallet and whose
--    details carry a different, non-empty pvb_wallet.
-- 2. Ledger rows with NULL pvb_reference take the inbox `reference` (the
--    envelope pvb_reference for these event types) of their own event, when
--    that value is unique among candidates and unused in the ledger.
CREATE OR REPLACE FUNCTION public.piggyvest_repair_pvb_reference_attribution()
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  inbox_rows integer;
  inflow_rows integer;
  interest_rows integer;
BEGIN
  UPDATE public.piggyvest_webhook_inbox
  SET wallet_id = event_details->>'pvb_wallet'
  WHERE event_type = 'interest-payout.success'
    AND jsonb_typeof(event_details->'pvb_wallet') = 'string'
    AND length(btrim(event_details->>'pvb_wallet')) > 0
    AND wallet_id IS NOT NULL
    AND wallet_id = event_details->>'destination_wallet'
    AND wallet_id <> event_details->>'pvb_wallet';
  GET DIAGNOSTICS inbox_rows = ROW_COUNT;

  WITH candidate AS (
    SELECT credit.provider_transaction_id AS ledger_key, inbox.reference AS pvb_reference
    FROM public.piggyvest_inflow_credits AS credit
    JOIN public.piggyvest_webhook_inbox AS inbox
      ON inbox.event_id = credit.event_id
     AND inbox.event_type = 'bank-transfer.inflow.success'
    WHERE credit.pvb_reference IS NULL
      AND inbox.reference IS NOT NULL
      AND length(btrim(inbox.reference)) > 0
  ), unique_candidate AS (
    SELECT ledger_key, pvb_reference FROM candidate
    WHERE pvb_reference IN (
      SELECT pvb_reference FROM candidate GROUP BY pvb_reference HAVING count(*) = 1)
      AND NOT EXISTS (SELECT 1 FROM public.piggyvest_inflow_credits AS used
        WHERE used.pvb_reference = candidate.pvb_reference)
  )
  UPDATE public.piggyvest_inflow_credits AS credit
  SET pvb_reference = unique_candidate.pvb_reference
  FROM unique_candidate
  WHERE credit.provider_transaction_id = unique_candidate.ledger_key
    AND credit.pvb_reference IS NULL;
  GET DIAGNOSTICS inflow_rows = ROW_COUNT;

  WITH candidate AS (
    SELECT payout.provider_payout_id AS ledger_key, inbox.reference AS pvb_reference
    FROM public.piggyvest_interest_payouts AS payout
    JOIN public.piggyvest_webhook_inbox AS inbox
      ON inbox.event_id = payout.event_id
     AND inbox.event_type = 'interest-payout.success'
    WHERE payout.pvb_reference IS NULL
      AND inbox.reference IS NOT NULL
      AND length(btrim(inbox.reference)) > 0
  ), unique_candidate AS (
    SELECT ledger_key, pvb_reference FROM candidate
    WHERE pvb_reference IN (
      SELECT pvb_reference FROM candidate GROUP BY pvb_reference HAVING count(*) = 1)
      AND NOT EXISTS (SELECT 1 FROM public.piggyvest_interest_payouts AS used
        WHERE used.pvb_reference = candidate.pvb_reference)
  )
  UPDATE public.piggyvest_interest_payouts AS payout
  SET pvb_reference = unique_candidate.pvb_reference
  FROM unique_candidate
  WHERE payout.provider_payout_id = unique_candidate.ledger_key
    AND payout.pvb_reference IS NULL;
  GET DIAGNOSTICS interest_rows = ROW_COUNT;

  RETURN jsonb_build_object('inbox_reattributed', inbox_rows,
    'inflow_backfilled', inflow_rows, 'interest_backfilled', interest_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.piggyvest_repair_pvb_reference_attribution()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.piggyvest_repair_pvb_reference_attribution();

ALTER TABLE public.piggyvest_inflow_credits
  ADD CONSTRAINT piggyvest_inflow_credits_pvb_reference_key UNIQUE (pvb_reference);
ALTER TABLE public.piggyvest_interest_payouts
  ADD CONSTRAINT piggyvest_interest_payouts_pvb_reference_key UNIQUE (pvb_reference);

CREATE INDEX IF NOT EXISTS piggyvest_inflow_credits_legacy_reference_idx
  ON public.piggyvest_inflow_credits (customer_id) WHERE pvb_reference IS NULL;
CREATE INDEX IF NOT EXISTS piggyvest_interest_payouts_legacy_reference_idx
  ON public.piggyvest_interest_payouts (customer_id) WHERE pvb_reference IS NULL;

COMMENT ON COLUMN public.piggyvest_inflow_credits.pvb_reference IS
  'PVB credit id (envelope pvb_reference): the unique credit key. NULL only on legacy rows without inbox evidence.';
COMMENT ON COLUMN public.piggyvest_inflow_credits.provider_transaction_id IS
  'PVB-internal eventData.transaction_id. Audit column; also the stable plan-transfer projection key of the first writer.';
COMMENT ON COLUMN public.piggyvest_interest_payouts.pvb_reference IS
  'PVB credit id (envelope pvb_reference): the unique credit key. NULL only on legacy rows without inbox evidence.';
COMMENT ON COLUMN public.piggyvest_interest_payouts.provider_payout_id IS
  'PVB-internal eventData.id. Audit column.';

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.inflow_credit_insert(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
    OR jsonb_typeof(p->'pvb_reference') IS DISTINCT FROM 'string'
    OR length(btrim(p->>'pvb_reference')) = 0 THEN
    RAISE EXCEPTION 'Invalid inflow request' USING ERRCODE = '22023';
  END IF;
  -- Exempt the legacy credit's own redelivery (same internal id): it falls
  -- through to ON CONFLICT and dedupes in the app instead of 503-looping.
  IF EXISTS (SELECT 1 FROM public.piggyvest_inflow_credits
      WHERE pvb_reference IS NULL AND customer_id = p->>'customer_id')
    AND NOT EXISTS (SELECT 1 FROM public.piggyvest_inflow_credits
      WHERE provider_transaction_id = p->>'provider_transaction_id') THEN
    RAISE EXCEPTION 'Inflow ledger has legacy rows without pvb_reference for this customer'
      USING ERRCODE = '55000';
  END IF;
  WITH inserted AS (
    INSERT INTO public.piggyvest_inflow_credits (
      pvb_reference, provider_transaction_id, event_data_id, event_id, customer_id,
      wallet_id, amount_kobo, fee_kobo, reference, session_id, credited_at)
    VALUES (p->>'pvb_reference', p->>'provider_transaction_id', p->>'event_data_id',
      p->>'event_id', p->>'customer_id', p->>'wallet_id', (p->>'amount_kobo')::bigint,
      (p->>'fee_kobo')::bigint, p->>'reference', p->>'session_id',
      (p->>'credited_at')::timestamptz)
    ON CONFLICT DO NOTHING
    RETURNING pvb_reference, provider_transaction_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'pvb_reference', pvb_reference, 'provider_transaction_id', provider_transaction_id)),
    '[]'::jsonb)
    INTO result FROM inserted;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.inflow_credit_read(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
    OR (p ? 'pvb_reference') = (p ? 'provider_transaction_id') THEN
    RAISE EXCEPTION 'Invalid inflow request' USING ERRCODE = '22023';
  END IF;
  SELECT to_jsonb(r) INTO result FROM (
    SELECT pvb_reference, provider_transaction_id, customer_id, wallet_id, amount_kobo,
      fee_kobo, reference, session_id, event_data_id, credited_at
    FROM public.piggyvest_inflow_credits
    WHERE CASE WHEN p ? 'pvb_reference' THEN pvb_reference = p->>'pvb_reference'
      ELSE provider_transaction_id = p->>'provider_transaction_id' END) AS r;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.interest_payout_insert(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
    OR jsonb_typeof(p->'pvb_reference') IS DISTINCT FROM 'string'
    OR length(btrim(p->>'pvb_reference')) = 0 THEN
    RAISE EXCEPTION 'Invalid interest request' USING ERRCODE = '22023';
  END IF;
  -- Exempt the legacy payout's own redelivery (same internal id).
  IF EXISTS (SELECT 1 FROM public.piggyvest_interest_payouts
      WHERE pvb_reference IS NULL AND customer_id = p->>'customer_id')
    AND NOT EXISTS (SELECT 1 FROM public.piggyvest_interest_payouts
      WHERE provider_payout_id = p->>'provider_payout_id') THEN
    RAISE EXCEPTION 'Interest ledger has legacy rows without pvb_reference for this customer'
      USING ERRCODE = '55000';
  END IF;
  WITH inserted AS (
    INSERT INTO public.piggyvest_interest_payouts (
      pvb_reference, provider_payout_id, event_id, customer_id, wallet_id, amount_kobo,
      gross_kobo, withholding_tax_kobo, net_kobo, reference, batch_id, paid_at)
    VALUES (p->>'pvb_reference', p->>'provider_payout_id', p->>'event_id',
      p->>'customer_id', p->>'wallet_id', (p->>'amount_kobo')::bigint,
      (p->>'gross_kobo')::bigint, (p->>'withholding_tax_kobo')::bigint,
      (p->>'net_kobo')::bigint, p->>'reference', p->>'batch_id',
      (p->>'paid_at')::timestamptz)
    ON CONFLICT DO NOTHING
    RETURNING pvb_reference, provider_payout_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'pvb_reference', pvb_reference, 'provider_payout_id', provider_payout_id)),
    '[]'::jsonb)
    INTO result FROM inserted;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.interest_payout_read(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
    OR (p ? 'pvb_reference') = (p ? 'provider_payout_id') THEN
    RAISE EXCEPTION 'Invalid interest request' USING ERRCODE = '22023';
  END IF;
  SELECT to_jsonb(r) INTO result FROM (
    SELECT pvb_reference, provider_payout_id, customer_id, wallet_id, amount_kobo,
      gross_kobo, withholding_tax_kobo, net_kobo, reference, batch_id, paid_at
    FROM public.piggyvest_interest_payouts
    WHERE CASE WHEN p ? 'pvb_reference' THEN pvb_reference = p->>'pvb_reference'
      ELSE provider_payout_id = p->>'provider_payout_id' END) AS r;
  RETURN result;
END;
$$;

-- CREATE OR REPLACE keeps the existing grants; restate them so this
-- migration is self-describing and a replay from scratch matches.
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.inflow_credit_insert(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.inflow_credit_read(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.interest_payout_insert(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.interest_payout_read(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.inflow_credit_insert(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.inflow_credit_read(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.interest_payout_insert(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.interest_payout_read(jsonb) TO piggyvest_webhook_intake;

COMMIT;
