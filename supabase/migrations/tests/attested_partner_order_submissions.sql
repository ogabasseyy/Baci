-- Disposable database with both partner migrations and a fixture Vault secret.
BEGIN;

CREATE FUNCTION pg_temp.partner_order_proof(
  quote_id uuid, merchant_id uuid, connection_id text, partner_order_id text,
  key_hash text, submission jsonb, operation text DEFAULT 'submit_partner_order'
)
RETURNS jsonb LANGUAGE sql AS $$
  WITH payload AS (
    SELECT (jsonb_build_object('connection_id', connection_id, 'partner_order_id', partner_order_id)
      || CASE WHEN operation = 'submit_partner_order' THEN
        jsonb_build_object('idempotency_hash', key_hash, 'submission', submission)
      ELSE '{}'::jsonb END)::text AS value
  )
  SELECT jsonb_build_object(
    'version', 'baci-shipping-quote-proof:v1',
    'action', operation,
    'merchant_id', merchant_id,
    'subject_id', quote_id,
    'issued_at', now()::text,
    'payload_text', payload.value,
    'signature', encode(extensions.hmac(
      concat_ws(E'\n', 'baci:shipping-quote-rpc:v1', 'baci-shipping-quote-proof:v1',
        operation, quote_id, merchant_id, now()::text, payload.value),
      'fixture-partner-quote-proof-secret', 'sha256'
    ), 'hex')
  ) FROM payload;
$$;

INSERT INTO public.merchants (id)
VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO private.partner_delivery_quotes (id, merchant_id, connection_id, created_at, expires_at, snapshot)
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'fixture-connection', now() - interval '20 minutes', now() - interval '10 minutes', '{"total_minor":171200}'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'fixture-connection', now(), now() + interval '10 minutes', '{"total_minor":171200}');

SET LOCAL ROLE anon;
DO $$
DECLARE
  merchant_id constant uuid := '10000000-0000-4000-8000-000000000001';
  quote_id constant uuid := '20000000-0000-4000-8000-000000000001';
  second_quote constant uuid := '20000000-0000-4000-8000-000000000002';
  connection_id constant text := 'fixture-connection';
  partner_order_id constant text := 'external-order-one';
  key_hash constant text := repeat('a', 64);
  submission constant jsonb := '{"payment":{"reference":"fixture-payment","amount_minor":171200}}';
  proof constant jsonb := pg_temp.partner_order_proof(quote_id, merchant_id, connection_id, partner_order_id, key_hash, submission);
  receipt jsonb;
BEGIN
  IF has_table_privilege(current_user, (
    SELECT c.oid FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private' AND c.relname = 'partner_order_submissions'
  ), 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'partner order table accessible to caller';
  END IF;

  receipt := public.submit_partner_order(
    quote_id, merchant_id, connection_id, partner_order_id, key_hash, submission, proof
  );
  IF receipt->>'status' IS DISTINCT FROM 'pending_verification'
     OR receipt->>'submission_id' IS NULL
     OR receipt IS DISTINCT FROM public.submit_partner_order(
          quote_id, merchant_id, connection_id, partner_order_id, key_hash, submission, proof
        ) THEN
    RAISE EXCEPTION 'receipt did not remain pending or replay changed its identity';
  END IF;

  IF receipt IS DISTINCT FROM public.read_partner_order_submission(
       merchant_id, quote_id, connection_id, partner_order_id,
       pg_temp.partner_order_proof(quote_id, merchant_id, connection_id, partner_order_id,
         key_hash, submission, 'read_partner_order_submission')
     ) THEN
    RAISE EXCEPTION 'lookup did not return the stored receipt';
  END IF;

  IF public.read_partner_order_submission(
       merchant_id, quote_id, 'other-connection', partner_order_id,
       pg_temp.partner_order_proof(quote_id, merchant_id, 'other-connection', partner_order_id,
         key_hash, submission, 'read_partner_order_submission')
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'lookup crossed connection boundary';
  END IF;

  BEGIN
    PERFORM public.read_partner_order_submission(merchant_id, quote_id, connection_id, partner_order_id, proof);
    RAISE EXCEPTION 'submission proof authorized lookup';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.submit_partner_order(
      quote_id, merchant_id, connection_id, partner_order_id, key_hash, submission || '{"extra":true}', proof
    );
    RAISE EXCEPTION 'changed payload accepted with original proof';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.submit_partner_order(
      quote_id, merchant_id, 'other-connection', partner_order_id, key_hash, submission,
      pg_temp.partner_order_proof(quote_id, merchant_id, 'other-connection', partner_order_id, key_hash, submission)
    );
    RAISE EXCEPTION 'another connection acquired the quote';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  BEGIN
    PERFORM public.submit_partner_order(
      second_quote, merchant_id, connection_id, partner_order_id, key_hash, submission,
      pg_temp.partner_order_proof(second_quote, merchant_id, connection_id, partner_order_id, key_hash, submission)
    );
    RAISE EXCEPTION 'existing order identity switched quotes';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    PERFORM public.submit_partner_order(
      quote_id, merchant_id, connection_id, 'second-order', repeat('b', 64), submission,
      pg_temp.partner_order_proof(quote_id, merchant_id, connection_id, 'second-order', repeat('b', 64), submission)
    );
    RAISE EXCEPTION 'quote accepted two submissions';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM private.partner_order_submissions) <> 1 THEN
    RAISE EXCEPTION 'duplicate or rejected submissions wrote extra rows';
  END IF;
END;
$$;
ROLLBACK;
