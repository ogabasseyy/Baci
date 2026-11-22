-- Disposable database with the partner quote, order, capture and settlement migrations.
BEGIN;

INSERT INTO public.merchants (id)
VALUES ('10000000-0000-4000-8000-000000000001');

INSERT INTO private.partner_delivery_quotes (id, merchant_id, connection_id, created_at, expires_at, snapshot)
SELECT format('20000000-0000-4000-8000-00000000000%s', n)::uuid,
  '10000000-0000-4000-8000-000000000001', 'fixture-connection',
  now() - interval '20 minutes', now() - interval '10 minutes',
  CASE WHEN n = 3 THEN '{"currency":"NGN"}'::jsonb
  ELSE '{"currency":"NGN","settlement_basis":"base_plus_delivery","merchant_payable_minor":170000}'::jsonb END
FROM generate_series(1, 4) AS n;

INSERT INTO private.partner_order_submissions (
  id, merchant_id, connection_id, quote_id, partner_order_id, idempotency_hash, submission
)
SELECT format('30000000-0000-4000-8000-00000000000%s', n)::uuid,
  '10000000-0000-4000-8000-000000000001', 'fixture-connection',
  format('20000000-0000-4000-8000-00000000000%s', n)::uuid, 'external-' || n,
  repeat(n::text, 64), '{}'
FROM generate_series(1, 4) AS n;

INSERT INTO private.partner_payment_captures (
  submission_id, source, provider_account, payment_reference, amount_minor, currency, captured_at
)
SELECT format('30000000-0000-4000-8000-00000000000%s', n)::uuid,
  'buyer-provider', 'buyer-account', 'capture-' || n, 171200, 'NGN', now() - interval '15 minutes'
FROM generate_series(1, 3) AS n;

CREATE FUNCTION pg_temp.record_settlement(
  n integer, allocation text, amount_minor bigint, connection_id text DEFAULT 'fixture-connection'
)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT private.record_verified_partner_settlement(
    format('30000000-0000-4000-8000-00000000000%s', n)::uuid,
    '10000000-0000-4000-8000-000000000001', connection_id, 'merchant-payout',
    'merchant-bank-account', 'payout-001', allocation, amount_minor, 'NGN',
    now() - interval '5 minutes'
  );
$$;

DO $$
DECLARE
  receipt jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role
    WHERE has_function_privilege(role,
      'private.record_verified_partner_settlement(uuid,uuid,text,text,text,text,text,bigint,text,timestamptz)',
      'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'untrusted role can record a verified settlement';
  END IF;

  BEGIN
    PERFORM pg_temp.record_settlement(1, 'allocation-one', 170000, 'other-connection');
    RAISE EXCEPTION 'settlement crossed connection boundary';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  BEGIN
    PERFORM pg_temp.record_settlement(1, 'allocation-one', 171200);
    RAISE EXCEPTION 'buyer amount was mistaken for merchant settlement';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM pg_temp.record_settlement(3, 'allocation-three', 170000);
    RAISE EXCEPTION 'settlement accepted without an agreed amount on quote';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM pg_temp.record_settlement(4, 'allocation-four', 170000);
    RAISE EXCEPTION 'settlement accepted without a verified capture';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  receipt := pg_temp.record_settlement(1, 'allocation-one', 170000);
  IF receipt->>'status' IS DISTINCT FROM 'settlement_verified'
     OR receipt IS DISTINCT FROM pg_temp.record_settlement(1, 'allocation-one', 170000)
     OR receipt ?| ARRAY['payout_reference', 'allocation_reference', 'order_id']
  THEN
    RAISE EXCEPTION 'verified receipt leaked settlement or replay changed its result';
  END IF;

  BEGIN
    PERFORM pg_temp.record_settlement(2, 'allocation-one', 170000);
    RAISE EXCEPTION 'payout allocation settled two submissions';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  receipt := pg_temp.record_settlement(2, 'allocation-two', 170000);
  IF receipt->>'status' IS DISTINCT FROM 'settlement_verified'
     OR (SELECT count(*) FROM private.partner_order_settlements) <> 2 THEN
    RAISE EXCEPTION 'distinct allocations in one payout did not reconcile';
  END IF;
END;
$$;

ROLLBACK;
