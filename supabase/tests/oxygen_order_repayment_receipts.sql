BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index
    WHERE indexrelid = 'oxygen_private.oxygen_callback_repayment_receipts_idx'::regclass
      AND indisvalid AND indisready
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
INSERT INTO oxygen_private.provider_states (workflow_id, state)
VALUES ('d5010000-0000-4000-8000-000000000041',
  '{"bookingReference":"d5010000-0000-4000-8000-000000000051","booking":{"status":"ACTIVATED"}}');
INSERT INTO oxygen_private.partner_workers (partner_reference, worker_user_id)
VALUES ('receipt-partner', auth.uid());
INSERT INTO oxygen_private.runtime_bindings (merchant_id, worker_user_id, partner_reference, enabled)
VALUES ('d5010000-0000-4000-8000-000000000011', auth.uid(), 'receipt-partner', true);

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
    base || '{"transactionReference":"second","deduplicationKey":"transaction-loan_repayment:second"}');
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
    OR has_function_privilege('anon', 'public.oxygen_order_repayment_receipts(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Callback receipt access is too broad';
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
