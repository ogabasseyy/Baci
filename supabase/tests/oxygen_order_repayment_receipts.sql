BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index
    WHERE indexrelid IN (
      'oxygen_private.oxygen_callback_repayment_receipts_idx'::regclass,
      'oxygen_private.oxygen_state_canonical_booking_idx'::regclass
    )
      AND indisvalid AND indisready
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Repayment receipt lookup index is missing or invalid';
  END IF;
END $$;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('d5010000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'repayment-owner@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('d5010000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'repayment-worker@example.test', 'test', now(), now(), now(), '{}', '{}');
SELECT set_config('request.jwt.claim.sub', 'd5010000-0000-4000-8000-000000000002', true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES ('d5010000-0000-4000-8000-000000000011', auth.uid(),
  'repayment-worker@example.test', 'Test shop', 'oxygen-repayment-receipt-fixture');
INSERT INTO public.customers (id, merchant_id, user_id, first_name, last_name, email)
VALUES ('d5010000-0000-4000-8000-000000000021', 'd5010000-0000-4000-8000-000000000011',
  'd5010000-0000-4000-8000-000000000001', 'Test', 'Customer', 'repayment-owner@example.test');
INSERT INTO public.orders (id, merchant_id, customer_id, order_number, total, currency, payment_status, payment_method)
VALUES ('d5010000-0000-4000-8000-000000000031', 'd5010000-0000-4000-8000-000000000011',
  'd5010000-0000-4000-8000-000000000021', 'REPAYMENT-FIXTURE', 80000, 'NGN', 'unpaid', 'oxygen');
INSERT INTO public.oxygen_workflows (id, order_id, merchant_id, customer_id, stage)
VALUES ('d5010000-0000-4000-8000-000000000041', 'd5010000-0000-4000-8000-000000000031',
  'd5010000-0000-4000-8000-000000000011', 'd5010000-0000-4000-8000-000000000021', 'activated');
INSERT INTO oxygen_private.partner_workers (partner_reference, worker_user_id)
VALUES ('receipt-partner', auth.uid()), ('another-partner', auth.uid());
INSERT INTO oxygen_private.runtime_bindings (merchant_id, worker_user_id, partner_reference, enabled)
VALUES ('d5010000-0000-4000-8000-000000000011', auth.uid(), 'receipt-partner', true);
INSERT INTO oxygen_private.commands (id, workflow_id, idempotency_key, expected_version, channel, command)
VALUES ('d5010000-0000-4000-8000-000000000061', 'd5010000-0000-4000-8000-000000000041',
  'd5010000-0000-4000-8000-000000000071', 0, 'web', '{"action":"book"}');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  command_id constant uuid := 'd5010000-0000-4000-8000-000000000061';
  owner_id constant text := 'd5010000-0000-4000-8000-000000000001';
  worker_id constant text := 'd5010000-0000-4000-8000-000000000002';
  payload jsonb := jsonb_build_object('commandId', command_id);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', owner_id, true);
  BEGIN
    PERFORM public.oxygen_runtime('claim', command_id, payload);
    RAISE EXCEPTION 'Customer identity unexpectedly claimed an Oxygen booking';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', worker_id, true);
  IF public.oxygen_runtime('claim', command_id, payload) #>> '{context,partnerReference}'
    IS DISTINCT FROM 'receipt-partner' THEN
    RAISE EXCEPTION 'Oxygen runtime claim did not return the partner pinned for repayment reports';
  END IF;
END $$;
RESET ROLE;
-- Rotate the binding while the booking result is in flight.
UPDATE oxygen_private.runtime_bindings SET partner_reference = 'another-partner'
WHERE merchant_id = 'd5010000-0000-4000-8000-000000000011';
INSERT INTO oxygen_private.provider_states (workflow_id, state)
VALUES ('d5010000-0000-4000-8000-000000000041',
  '{"bookingReference":"D5010000-0000-4000-8000-000000000051","booking":{"status":"ACTIVATED","loan_reference":"D5010000-0000-4000-8000-000000000051"}}');
UPDATE oxygen_private.commands SET status = 'succeeded'
WHERE id = 'd5010000-0000-4000-8000-000000000061';
-- The exact command ID still proves the partner after the command completes.
INSERT INTO oxygen_private.provider_reference_history (command_id, workflow_id, booking_reference)
VALUES ('d5010000-0000-4000-8000-000000000061', 'd5010000-0000-4000-8000-000000000041',
  'd5010000-0000-4000-8000-000000000051');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM oxygen_private.repayment_booking_claims
    WHERE command_id = 'd5010000-0000-4000-8000-000000000061') THEN
    RAISE EXCEPTION 'A completed booking left an unnecessary pending claim';
  END IF;
END $$;
UPDATE oxygen_private.runtime_bindings SET partner_reference = 'receipt-partner'
WHERE merchant_id = 'd5010000-0000-4000-8000-000000000011';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  base jsonb := '{"kind":"transaction","bookedLoanReference":"d5010000-0000-4000-8000-000000000051","providerAmountSent":"10000.00","providerAmountDeducted":"10000.00"}';
  payment jsonb := base || '{"transactionReference":"same","deduplicationKey":"transaction-loan_repayment:same"}';
BEGIN
  IF public.oxygen_callback('accept', 'receipt-partner', payment)->>'result' <> 'accepted'
    OR public.oxygen_callback('accept', 'receipt-partner', payment)->>'result' <> 'duplicate' THEN
    RAISE EXCEPTION 'Repayment was not deduplicated';
  END IF;
  PERFORM public.oxygen_callback('accept', 'receipt-partner',
    base || '{"transactionReference":"second","deduplicationKey":"transaction-loan_repayment:second","bookedLoanReference":"D5010000-0000-4000-8000-000000000051"}');
  PERFORM public.oxygen_callback('accept', 'receipt-partner',
    base || '{"transactionReference":"same","deduplicationKey":"transaction-split_payment:same"}');
  PERFORM public.oxygen_callback('accept', 'receipt-partner',
    base || '{"transactionReference":"same","deduplicationKey":"transaction-repayment_setup:same"}');
  PERFORM public.oxygen_callback('accept', 'receipt-partner',
    base || '{"transactionReference":"same","deduplicationKey":"transaction:same"}');
  PERFORM public.oxygen_callback('accept', 'receipt-partner',
    base || '{"transactionReference":"zero","deduplicationKey":"transaction-loan_repayment:zero","providerAmountSent":"0.00"}');
  PERFORM public.oxygen_callback('accept', 'receipt-partner',
    base || '{"transactionReference":"other-loan","deduplicationKey":"transaction-loan_repayment:other-loan","bookedLoanReference":"d5010000-0000-4000-8000-000000000052"}');
  IF public.oxygen_order_repayment_receipts('d5010000-0000-4000-8000-000000000031') <> '[]' THEN
    RAISE EXCEPTION 'Worker is not the customer';
  END IF;
END $$;
RESET ROLE;

INSERT INTO oxygen_private.callback_inbox (partner_reference, environment, deduplication_key, payload_hash, event)
SELECT other.partner, other.environment, i.deduplication_key, i.payload_hash, i.event
FROM oxygen_private.callback_inbox AS i
CROSS JOIN (VALUES ('receipt-partner', 'production'), ('another-partner', 'staging'))
  AS other(partner, environment)
WHERE i.partner_reference = 'receipt-partner'
  AND i.deduplication_key = 'transaction-loan_repayment:same';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd5010000-0000-4000-8000-000000000001', true);
DO $$
DECLARE
  receipts jsonb := public.oxygen_order_repayment_receipts('d5010000-0000-4000-8000-000000000031');
BEGIN
  IF jsonb_array_length(receipts) <> 2 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(receipts) AS receipt
    WHERE NOT (receipt ?& ARRAY['id', 'recordedAt'])
       OR receipt - 'id' - 'recordedAt' <> '{}'
  ) THEN
    RAISE EXCEPTION 'Expected one minimal acknowledgement per actual repayment';
  END IF;
  IF has_table_privilege('authenticated', 'oxygen_private.callback_inbox', 'SELECT')
    OR has_table_privilege('authenticated', 'oxygen_private.repayment_booking_bindings', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated', 'oxygen_private.repayment_booking_claims', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_function_privilege('authenticated', 'oxygen_private.capture_repayment_booking_binding()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'oxygen_private.capture_repayment_booking_claim()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.oxygen_order_repayment_receipts(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Callback receipt access is too broad';
  END IF;
END $$;
RESET ROLE;

UPDATE oxygen_private.runtime_bindings SET enabled = false
WHERE merchant_id = 'd5010000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF jsonb_array_length(public.oxygen_order_repayment_receipts('d5010000-0000-4000-8000-000000000031')) <> 2 THEN
    RAISE EXCEPTION 'Disabling the provider hid previously recorded repayment acknowledgements';
  END IF;
END $$;
RESET ROLE;

UPDATE oxygen_private.runtime_bindings SET environment = 'production', enabled = true
WHERE merchant_id = 'd5010000-0000-4000-8000-000000000011';
-- A later callback authenticated under production cannot be attributed to
-- this staging booking simply because its body contains the reference.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd5010000-0000-4000-8000-000000000002', true);
DO $$ BEGIN
  IF public.oxygen_callback('accept', 'receipt-partner',
    '{"kind":"transaction","bookedLoanReference":"d5010000-0000-4000-8000-000000000051","providerAmountSent":"10000.00","providerAmountDeducted":"10000.00","transactionReference":"late","deduplicationKey":"transaction-loan_repayment:late"}'
  )->>'result' IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'Expected an accepted provider report in the replacement environment';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', 'd5010000-0000-4000-8000-000000000001', true);
DO $$ BEGIN
  IF jsonb_array_length(public.oxygen_order_repayment_receipts('d5010000-0000-4000-8000-000000000031')) <> 2 THEN
    RAISE EXCEPTION 'Changing the runtime environment hid acknowledgements or mixed environments';
  END IF;
END $$;
RESET ROLE;

UPDATE oxygen_private.runtime_bindings SET partner_reference = 'another-partner'
WHERE merchant_id = 'd5010000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF jsonb_array_length(public.oxygen_order_repayment_receipts('d5010000-0000-4000-8000-000000000031')) <> 2 THEN
    RAISE EXCEPTION 'Rebinding the merchant hid acknowledgements or mixed partners';
  END IF;
END $$;
RESET ROLE;

SAVEPOINT legacy_booking;
DELETE FROM oxygen_private.repayment_booking_bindings
WHERE workflow_id = 'd5010000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.oxygen_order_repayment_receipts('d5010000-0000-4000-8000-000000000031') <> '[]' THEN
    RAISE EXCEPTION 'A legacy booking without partner evidence showed acknowledgements';
  END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT legacy_booking;

SAVEPOINT ambiguous_booking;
SELECT set_config('request.jwt.claim.sub', 'd5010000-0000-4000-8000-000000000002', true);
INSERT INTO public.orders (id, merchant_id, customer_id, order_number, total, currency, payment_status, payment_method)
VALUES ('d5010000-0000-4000-8000-000000000032', 'd5010000-0000-4000-8000-000000000011',
  'd5010000-0000-4000-8000-000000000021', 'REPAYMENT-AMBIGUOUS', 80000, 'NGN', 'unpaid', 'oxygen');
INSERT INTO public.oxygen_workflows (id, order_id, merchant_id, customer_id, stage)
VALUES ('d5010000-0000-4000-8000-000000000042', 'd5010000-0000-4000-8000-000000000032',
  'd5010000-0000-4000-8000-000000000011', 'd5010000-0000-4000-8000-000000000021', 'activated');
INSERT INTO oxygen_private.provider_states (workflow_id, state)
VALUES ('d5010000-0000-4000-8000-000000000042',
  '{"bookingReference":"d5010000-0000-4000-8000-000000000051","booking":{"status":"ACTIVATED","loan_reference":"d5010000-0000-4000-8000-000000000051"}}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd5010000-0000-4000-8000-000000000001', true);
DO $$ BEGIN
  IF public.oxygen_order_repayment_receipts('d5010000-0000-4000-8000-000000000031') <> '[]' THEN
    RAISE EXCEPTION 'Case-equivalent booking across workflows leaked repayment reports';
  END IF;
END $$;
RESET ROLE;
INSERT INTO oxygen_private.repayment_booking_bindings
  (workflow_id, booking_reference, partner_reference, environment)
VALUES ('d5010000-0000-4000-8000-000000000042',
  'd5010000-0000-4000-8000-000000000051', 'receipt-partner', 'staging');
DELETE FROM oxygen_private.provider_states
WHERE workflow_id = 'd5010000-0000-4000-8000-000000000042';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.oxygen_order_repayment_receipts('d5010000-0000-4000-8000-000000000031') <> '[]' THEN
    RAISE EXCEPTION 'Historical booking conflict leaked repayment reports';
  END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT ambiguous_booking;

INSERT INTO oxygen_private.callback_inbox
  (partner_reference, environment, deduplication_key, payload_hash, event, received_at)
SELECT 'receipt-partner', 'staging', 'transaction-loan_repayment:limit-' || n,
  decode(repeat('a', 64), 'hex'),
  jsonb_build_object('kind', 'transaction',
    'bookedLoanReference', 'd5010000-0000-4000-8000-000000000051',
    'transactionReference', 'limit-' || n, 'providerAmountSent', '100'),
  now() + make_interval(secs => n)
FROM generate_series(1, 51) AS series(n);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF jsonb_array_length(public.oxygen_order_repayment_receipts('d5010000-0000-4000-8000-000000000031')) <> 50 THEN
    RAISE EXCEPTION 'Repayment history exceeded its customer-facing limit';
  END IF;
END $$;
RESET ROLE;

UPDATE public.oxygen_workflows SET stage = 'payment_required'
WHERE id = 'd5010000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.oxygen_order_repayment_receipts('d5010000-0000-4000-8000-000000000031') <> '[]' THEN
    RAISE EXCEPTION 'Loan without activation showed repayment acknowledgements';
  END IF;
END $$;
ROLLBACK;
