-- Disposable database with the partner quote, order and capture migrations.
BEGIN;

INSERT INTO public.merchants (id)
VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO private.partner_delivery_quotes (id, merchant_id, connection_id, created_at, expires_at, snapshot)
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'fixture-connection', now() - interval '20 minutes', now() - interval '10 minutes', '{}'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'fixture-connection', now() - interval '20 minutes', now() - interval '10 minutes', '{}');

INSERT INTO private.partner_order_submissions (
  id, merchant_id, connection_id, quote_id, partner_order_id, idempotency_hash, submission
) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'fixture-connection', '20000000-0000-4000-8000-000000000001', 'external-1', repeat('a', 64),
   '{"payment":{"source":"fixture","reference":"capture-001","amount_minor":252000,"currency":"NGN"}}'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'fixture-connection', '20000000-0000-4000-8000-000000000002', 'external-2', repeat('b', 64),
   '{"payment":{"source":"fixture","reference":"capture-001","amount_minor":252000,"currency":"NGN"}}');

DO $$
DECLARE
  merchant_id constant uuid := '10000000-0000-4000-8000-000000000001';
  quote_id constant uuid := '20000000-0000-4000-8000-000000000001';
  submission_id constant uuid := '30000000-0000-4000-8000-000000000001';
  captured_at constant timestamptz := now() - interval '15 minutes';
  receipt jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role
    WHERE has_function_privilege(role,
      'private.record_verified_partner_capture(uuid,uuid,text,uuid,text,text,text,text,bigint,text,timestamptz)',
      'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'untrusted role can record verified captures';
  END IF;

  BEGIN
    PERFORM private.record_verified_partner_capture(
      submission_id, merchant_id, 'other-connection', quote_id, 'external-1',
      'fixture', 'merchant-account', 'capture-001', 252000, 'NGN', captured_at
    );
    RAISE EXCEPTION 'capture crossed connection boundary';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  BEGIN
    PERFORM private.record_verified_partner_capture(
      submission_id, merchant_id, 'fixture-connection', quote_id, 'external-1',
      'fixture', 'merchant-account', 'capture-001', 252001, 'NGN', captured_at
    );
    RAISE EXCEPTION 'wrong amount accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM private.record_verified_partner_capture(
      submission_id, merchant_id, 'fixture-connection', quote_id, 'external-1',
      'fixture', 'merchant-account', 'capture-001', 252000, 'NGN', now() - interval '5 minutes'
    );
    RAISE EXCEPTION 'capture after quote expiry accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  receipt := private.record_verified_partner_capture(
    submission_id, merchant_id, 'fixture-connection', quote_id, 'external-1',
    'fixture', 'merchant-account', 'capture-001', 252000, 'NGN', captured_at
  );
  IF receipt->>'status' IS DISTINCT FROM 'payment_verified'
     OR receipt IS DISTINCT FROM private.record_verified_partner_capture(
       submission_id, merchant_id, 'fixture-connection', quote_id, 'external-1',
       'fixture', 'merchant-account', 'capture-001', 252000, 'NGN', captured_at
     )
     OR receipt ?| ARRAY['provider_account', 'payment_reference', 'amount_minor', 'order_id']
  THEN
    RAISE EXCEPTION 'verified receipt leaked evidence or replay changed its result';
  END IF;

  BEGIN
    PERFORM private.record_verified_partner_capture(
      '30000000-0000-4000-8000-000000000002', merchant_id, 'fixture-connection',
      '20000000-0000-4000-8000-000000000002', 'external-2',
      'fixture', 'merchant-account', 'capture-001', 252000, 'NGN', captured_at
    );
    RAISE EXCEPTION 'same provider capture attached to two submissions';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  IF (SELECT count(*) FROM private.partner_payment_captures) <> 1 THEN
    RAISE EXCEPTION 'capture tests wrote unexpected extra rows';
  END IF;
END;
$$;

ROLLBACK;
