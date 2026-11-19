-- Contract tests for 20261112050000_piggyvest_credit_pvb_reference_key:
-- PiggyVest (2026-11-11) named pvb_reference as a credit's unique key. The
-- intake functions must require it, dedupe on it (first writer wins even when
-- the internal id differs), still refuse a reused internal id, and read by
-- either key. Synthetic, transaction-local fixture; rolled back.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'piggyvest_inflow_credits_pvb_reference_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'inflow credits must be unique on pvb_reference';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'piggyvest_interest_payouts_pvb_reference_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'interest payouts must be unique on pvb_reference';
  END IF;
END $$;

GRANT piggyvest_webhook_intake TO CURRENT_USER;
SET LOCAL ROLE piggyvest_webhook_intake;

DO $$
DECLARE
  inserted jsonb;
  row_json jsonb;
  credit jsonb := jsonb_build_object(
    'pvb_reference', 'PVB01PVBREF1', 'provider_transaction_id', 'pvbref-txn-1',
    'event_data_id', 'pvbref-data', 'event_id', 'pvbref-evt-1', 'customer_id', 'pvbref-cust',
    'wallet_id', 'pvbref-wallet', 'amount_kobo', 1000, 'fee_kobo', 0, 'reference', 'pvbref-ref',
    'session_id', NULL, 'credited_at', '2026-11-11T10:00:00.000Z');
  payout jsonb := jsonb_build_object(
    'pvb_reference', 'PVB01PVBREF2', 'provider_payout_id', 'pvbref-payout-1',
    'event_id', 'pvbref-evt-2', 'customer_id', 'pvbref-cust', 'wallet_id', 'pvbref-wallet',
    'amount_kobo', 90, 'gross_kobo', 100, 'withholding_tax_kobo', 10, 'net_kobo', 90,
    'reference', 'pvbref-ref', 'batch_id', 'pvbref-batch', 'paid_at', '2026-11-11T10:00:00.000Z');
BEGIN
  BEGIN
    PERFORM piggyvest_webhook_intake.inflow_credit_insert(credit - 'pvb_reference');
    RAISE EXCEPTION 'inflow insert without pvb_reference must be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_webhook_intake.interest_payout_insert(payout || '{"pvb_reference": " "}');
    RAISE EXCEPTION 'interest insert with blank pvb_reference must be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  inserted := piggyvest_webhook_intake.inflow_credit_insert(credit);
  IF inserted <> '[{"pvb_reference": "PVB01PVBREF1", "provider_transaction_id": "pvbref-txn-1"}]'::jsonb THEN
    RAISE EXCEPTION 'first inflow insert must report both keys, got %', inserted;
  END IF;
  -- Same credit redelivered with a different internal transaction id.
  IF piggyvest_webhook_intake.inflow_credit_insert(credit
      || '{"provider_transaction_id": "pvbref-txn-2", "event_id": "pvbref-evt-3"}') <> '[]'::jsonb THEN
    RAISE EXCEPTION 'same pvb_reference with a new transaction id must not credit twice';
  END IF;
  -- Another credit reusing the internal transaction id still cannot insert.
  IF piggyvest_webhook_intake.inflow_credit_insert(credit
      || '{"pvb_reference": "PVB01PVBREF9", "event_id": "pvbref-evt-4"}') <> '[]'::jsonb THEN
    RAISE EXCEPTION 'a reused transaction id must not insert a second credit';
  END IF;
  row_json := piggyvest_webhook_intake.inflow_credit_read('{"pvb_reference": "PVB01PVBREF1"}');
  IF row_json->>'provider_transaction_id' IS DISTINCT FROM 'pvbref-txn-1' THEN
    RAISE EXCEPTION 'inflow read by pvb_reference must return the first writer, got %', row_json;
  END IF;
  row_json := piggyvest_webhook_intake.inflow_credit_read('{"provider_transaction_id": "pvbref-txn-1"}');
  IF row_json->>'pvb_reference' IS DISTINCT FROM 'PVB01PVBREF1' THEN
    RAISE EXCEPTION 'inflow read by legacy key must return pvb_reference, got %', row_json;
  END IF;
  BEGIN
    PERFORM piggyvest_webhook_intake.inflow_credit_read(
      '{"pvb_reference": "a", "provider_transaction_id": "b"}');
    RAISE EXCEPTION 'inflow read must take exactly one key';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  inserted := piggyvest_webhook_intake.interest_payout_insert(payout);
  IF jsonb_array_length(inserted) <> 1 THEN
    RAISE EXCEPTION 'first interest insert must report one row';
  END IF;
  IF piggyvest_webhook_intake.interest_payout_insert(payout
      || '{"provider_payout_id": "pvbref-payout-2"}') <> '[]'::jsonb THEN
    RAISE EXCEPTION 'same pvb_reference with a new payout id must not credit twice';
  END IF;
  row_json := piggyvest_webhook_intake.interest_payout_read('{"pvb_reference": "PVB01PVBREF2"}');
  IF row_json->>'provider_payout_id' IS DISTINCT FROM 'pvbref-payout-1'
    OR (row_json->>'net_kobo')::bigint <> 90 THEN
    RAISE EXCEPTION 'interest read by pvb_reference mismatch: %', row_json;
  END IF;
END $$;

-- An unresolved legacy row (NULL pvb_reference) blocks new credits,
-- retryably, so a redelivery under a new internal id cannot double-credit.
RESET ROLE;
INSERT INTO public.piggyvest_inflow_credits (provider_transaction_id, event_data_id, event_id,
  customer_id, wallet_id, amount_kobo, fee_kobo, reference, credited_at)
VALUES ('pvbref-legacy-txn', 'd', 'pvbref-legacy-evt', 'c', 'w', 1000, 0, 'r', now());
INSERT INTO public.piggyvest_interest_payouts (provider_payout_id, event_id, customer_id,
  wallet_id, amount_kobo, gross_kobo, withholding_tax_kobo, net_kobo, reference, batch_id, paid_at)
VALUES ('pvbref-legacy-payout', 'pvbref-legacy-evt', 'c', 'w', 90, 100, 10, 90, 'r', 'b', now());
SET LOCAL ROLE piggyvest_webhook_intake;

DO $$
BEGIN
  BEGIN
    PERFORM piggyvest_webhook_intake.inflow_credit_insert(jsonb_build_object(
      'pvb_reference', 'PVB01PVBREF7', 'provider_transaction_id', 'pvbref-legacy-txn-2',
      'event_data_id', 'd', 'event_id', 'pvbref-evt-7', 'customer_id', 'c', 'wallet_id', 'w',
      'amount_kobo', 1000, 'fee_kobo', 0, 'reference', 'r',
      'credited_at', '2026-11-11T10:00:00.000Z'));
    RAISE EXCEPTION 'inflow insert must fail closed while a legacy NULL row exists';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_webhook_intake.interest_payout_insert(jsonb_build_object(
      'pvb_reference', 'PVB01PVBREF8', 'provider_payout_id', 'pvbref-legacy-payout-2',
      'event_id', 'pvbref-evt-8', 'customer_id', 'c', 'wallet_id', 'w', 'amount_kobo', 90,
      'gross_kobo', 100, 'withholding_tax_kobo', 10, 'net_kobo', 90, 'reference', 'r',
      'batch_id', 'b', 'paid_at', '2026-11-11T10:00:00.000Z'));
    RAISE EXCEPTION 'interest insert must fail closed while a legacy NULL row exists';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  -- The legacy credit's own redelivery (same internal ids) is exempt: it
  -- reports [] for the app's duplicate path instead of raising.
  IF piggyvest_webhook_intake.inflow_credit_insert(jsonb_build_object(
      'pvb_reference', 'PVB01PVBREF11', 'provider_transaction_id', 'pvbref-legacy-txn',
      'event_data_id', 'd', 'event_id', 'pvbref-evt-11', 'customer_id', 'c', 'wallet_id', 'w',
      'amount_kobo', 1000, 'fee_kobo', 0, 'reference', 'r',
      'credited_at', '2026-11-11T10:00:00.000Z')) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'legacy inflow redelivery must dedupe, not raise';
  END IF;
  IF piggyvest_webhook_intake.interest_payout_insert(jsonb_build_object(
      'pvb_reference', 'PVB01PVBREF12', 'provider_payout_id', 'pvbref-legacy-payout',
      'event_id', 'pvbref-evt-12', 'customer_id', 'c', 'wallet_id', 'w', 'amount_kobo', 90,
      'gross_kobo', 100, 'withholding_tax_kobo', 10, 'net_kobo', 90, 'reference', 'r',
      'batch_id', 'b', 'paid_at', '2026-11-11T10:00:00.000Z')) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'legacy interest redelivery must dedupe, not raise';
  END IF;
  -- A known pvb_reference retried with a rotated internal id is exempt too:
  -- seed a backfilled credit for the same customer, then retry it.
  RESET ROLE;
  INSERT INTO public.piggyvest_inflow_credits (pvb_reference, provider_transaction_id,
    event_data_id, event_id, customer_id, wallet_id, amount_kobo, fee_kobo, reference, credited_at)
  VALUES ('PVB01KNOWN', 'pvbref-known-txn', 'd', 'pvbref-known-evt', 'c', 'w', 1000, 0, 'r', now());
  SET LOCAL ROLE piggyvest_webhook_intake;
  IF piggyvest_webhook_intake.inflow_credit_insert(jsonb_build_object(
      'pvb_reference', 'PVB01KNOWN', 'provider_transaction_id', 'pvbref-known-txn-rotated',
      'event_data_id', 'd', 'event_id', 'pvbref-evt-13', 'customer_id', 'c', 'wallet_id', 'w',
      'amount_kobo', 1000, 'fee_kobo', 0, 'reference', 'r',
      'credited_at', '2026-11-11T10:00:00.000Z')) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'known pvb_reference retry must dedupe, not raise';
  END IF;
  -- The gate is per customer: another customer's credit still lands.
  IF jsonb_array_length(piggyvest_webhook_intake.inflow_credit_insert(jsonb_build_object(
      'pvb_reference', 'PVB01PVBREF10', 'provider_transaction_id', 'pvbref-other-txn',
      'event_data_id', 'd', 'event_id', 'pvbref-evt-10', 'customer_id', 'other-customer',
      'wallet_id', 'w2', 'amount_kobo', 1000, 'fee_kobo', 0, 'reference', 'r',
      'credited_at', '2026-11-11T10:00:00.000Z'))) <> 1 THEN
    RAISE EXCEPTION 'another customer must not be blocked by a legacy row';
  END IF;
END $$;

-- Regression (bugfix): an interest inbox row recorded before the fix with
-- the PVB-internal destination_wallet becomes replay-compatible, rows
-- without matching stored evidence stay untouched, and legacy ledger rows
-- take their own event's pvb_reference.
RESET ROLE;
DO $$
DECLARE
  result jsonb;
BEGIN
  IF has_function_privilege('anon', 'public.piggyvest_repair_pvb_reference_attribution()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.piggyvest_repair_pvb_reference_attribution()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.piggyvest_repair_pvb_reference_attribution()', 'EXECUTE')
    OR has_function_privilege('piggyvest_webhook_intake', 'public.piggyvest_repair_pvb_reference_attribution()', 'EXECUTE') THEN
    RAISE EXCEPTION 'repair function must not be executable by API or intake roles';
  END IF;

  INSERT INTO public.piggyvest_webhook_inbox (event_id, event_type, event_category, customer_id,
    wallet_id, reference, amount_kobo, status, event_details)
  VALUES
    ('repair-evt-old', 'interest-payout.success', 'interest-payout', 'repair-c', 'pvb-internal',
     'PVB01REPAIR1', 90, 'failed', '{"pvb_wallet": "plan-wallet", "destination_wallet": "pvb-internal"}'),
    ('repair-evt-other', 'interest-payout.success', 'interest-payout', 'repair-c', 'something-else',
     'PVB01REPAIR2', 90, 'failed', '{"pvb_wallet": "plan-wallet", "destination_wallet": "pvb-internal"}'),
    ('repair-evt-nowallet', 'interest-payout.success', 'interest-payout', 'repair-c', 'pvb-internal',
     'PVB01REPAIR3', 90, 'failed', '{"destination_wallet": "pvb-internal"}'),
    ('repair-evt-inflow', 'bank-transfer.inflow.success', 'bank-transfer', 'repair-c', 'plan-wallet',
     'PVB01REPAIR4', 1000, 'processed', NULL);
  INSERT INTO public.piggyvest_inflow_credits (provider_transaction_id, event_data_id, event_id,
    customer_id, wallet_id, amount_kobo, fee_kobo, reference, credited_at)
  VALUES ('repair-txn', 'd', 'repair-evt-inflow', 'repair-c', 'plan-wallet', 1000, 0, 'r', now());

  result := public.piggyvest_repair_pvb_reference_attribution();
  IF (result->>'inbox_reattributed')::int <> 1 OR (result->>'inflow_backfilled')::int < 1 THEN
    RAISE EXCEPTION 'repair counts unexpected: %', result;
  END IF;
  IF (SELECT wallet_id FROM public.piggyvest_webhook_inbox WHERE event_id = 'repair-evt-old') <> 'plan-wallet' THEN
    RAISE EXCEPTION 'destination-attributed interest inbox row must move to pvb_wallet';
  END IF;
  IF (SELECT wallet_id FROM public.piggyvest_webhook_inbox WHERE event_id = 'repair-evt-other') <> 'something-else'
    OR (SELECT wallet_id FROM public.piggyvest_webhook_inbox WHERE event_id = 'repair-evt-nowallet') <> 'pvb-internal' THEN
    RAISE EXCEPTION 'rows without matching stored evidence must stay untouched';
  END IF;
  IF (SELECT pvb_reference FROM public.piggyvest_inflow_credits WHERE provider_transaction_id = 'repair-txn')
      IS DISTINCT FROM 'PVB01REPAIR4' THEN
    RAISE EXCEPTION 'legacy inflow row must take its own event pvb_reference';
  END IF;
  result := public.piggyvest_repair_pvb_reference_attribution();
  IF (result->>'inbox_reattributed')::int <> 0 THEN
    RAISE EXCEPTION 'repair must be idempotent: %', result;
  END IF;
END $$;

ROLLBACK;
