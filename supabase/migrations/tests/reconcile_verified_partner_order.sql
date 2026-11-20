-- Run on a disposable database with the partner migrations, writer fixture,
-- and the fixture Vault secret used by the shipping quote proof verifier.
BEGIN;

CREATE FUNCTION pg_temp.partner_proof(action text, subject_id uuid, merchant_id uuid, payload jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'version', 'baci-shipping-quote-proof:v1',
    'action', action, 'merchant_id', merchant_id, 'subject_id', subject_id,
    'issued_at', now()::text, 'payload_text', payload::text,
    'signature', encode(extensions.hmac(
      concat_ws(E'\n', 'baci:shipping-quote-rpc:v1', 'baci-shipping-quote-proof:v1',
        action, subject_id, merchant_id, now()::text, payload::text),
      'fixture-partner-quote-proof-secret', 'sha256'
    ), 'hex')
  );
$$;

INSERT INTO public.merchants (id) VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.partner_writer_fixture_products (id, base_price, stock) VALUES
  ('40000000-0000-4000-8000-000000000001', 100, 10),
  ('40000000-0000-4000-8000-000000000002', 100.25, 10);

SET LOCAL ROLE anon;
DO $$
DECLARE
  merchant_id constant uuid := '10000000-0000-4000-8000-000000000001';
  connection_id constant text := 'fixture-connection';
  expiry constant timestamptz := now() + interval '10 minutes';
  quote_id uuid;
  order_reference text;
  key_hash text;
  snapshot jsonb;
  submission jsonb;
  evidence jsonb;
  bad_settlement jsonb;
  proof jsonb;
  receipt jsonb;
  outcome jsonb;
  submission_id uuid;
  n integer;
BEGIN
  FOR n IN 1..2 LOOP
    quote_id := format('20000000-0000-4000-8000-00000000000%s', n)::uuid;
    order_reference := 'external-' || n;
    key_hash := repeat(n::text, 64);
    snapshot := jsonb_build_object(
      'currency', 'NGN', 'settlement_basis', 'base_plus_delivery', 'merchant_payable_minor', 170000,
      'delivery_minor', 150000, 'tax_minor', 0, 'total_minor', 171200,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', format('40000000-0000-4000-8000-00000000000%s', n),
        'condition', 'new', 'quantity', 2, 'base_unit_price_minor', 10000
      )),
      'carrier_quote', '{"quote_request":{"receiver":{"address":"1 Fixture Road","city":"Ikeja","state":"Lagos","countryCode":"NG"}}}'::jsonb
    );
    PERFORM public.persist_partner_delivery_quote(quote_id, merchant_id, connection_id, expiry, snapshot,
      pg_temp.partner_proof('persist_partner_delivery_quote', quote_id, merchant_id,
        jsonb_build_object('connection_id', connection_id, 'expires_at', expiry, 'snapshot', snapshot)));
    submission := jsonb_build_object(
      'recipient', '{"name":"Fixture Recipient","email":"recipient@example.invalid","phone":"+2348000000000"}'::jsonb,
      'payment', jsonb_build_object('source', 'fixture', 'reference', 'capture-' || n, 'amount_minor', 171200, 'currency', 'NGN')
    );
    receipt := public.submit_partner_order(quote_id, merchant_id, connection_id, order_reference, key_hash, submission,
      pg_temp.partner_proof('submit_partner_order', quote_id, merchant_id,
        jsonb_build_object('connection_id', connection_id, 'partner_order_id', order_reference, 'idempotency_hash', key_hash, 'submission', submission)));
    submission_id := (receipt->>'submission_id')::uuid;
    IF receipt->>'status' IS DISTINCT FROM 'pending_verification' THEN
      RAISE EXCEPTION 'submission became paid before verification';
    END IF;
    evidence := jsonb_build_object(
      'quote_id', quote_id, 'partner_order_id', order_reference,
      'capture', jsonb_build_object('source', 'fixture', 'reference', 'capture-' || n,
        'provider_account', 'fixture-provider', 'amount_minor', 171200, 'currency', 'NGN', 'captured_at', now()),
      'settlement', jsonb_build_object('source', 'fixture-payout', 'settlement_account', 'fixture-bank',
        'payout_reference', 'fixture-payout-one', 'allocation_reference', 'allocation-' || n,
        'amount_minor', 170000, 'currency', 'NGN', 'settled_at', now())
    );
    proof := pg_temp.partner_proof('reconcile_verified_partner_order', submission_id, merchant_id,
      jsonb_build_object('connection_id', connection_id, 'evidence', evidence));
    BEGIN
      PERFORM public.reconcile_verified_partner_order(submission_id, merchant_id, connection_id, evidence, NULL);
      RAISE EXCEPTION 'unsigned evidence accepted' USING ERRCODE = '22023';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    IF n = 1 THEN
      bad_settlement := jsonb_set(evidence, '{settlement,amount_minor}', '169999');
      outcome := public.reconcile_verified_partner_order(
        submission_id, merchant_id, connection_id, bad_settlement,
        pg_temp.partner_proof('reconcile_verified_partner_order', submission_id, merchant_id,
          jsonb_build_object('connection_id', connection_id, 'evidence', bad_settlement))
      );
      IF outcome #>> '{receipt,status}' IS DISTINCT FROM 'review_required'
         OR outcome->>'hold_reason' IS DISTINCT FROM 'SETTLEMENT_REVIEW_REQUIRED' THEN
        RAISE EXCEPTION 'settlement mismatch did not record a review hold';
      END IF;
    END IF;
    outcome := public.reconcile_verified_partner_order(submission_id, merchant_id, connection_id, evidence, proof);
    IF n = 1 AND (
      outcome #>> '{receipt,status}' IS DISTINCT FROM 'accepted'
      OR outcome #>> '{receipt,order_id}' IS NULL OR outcome->>'hold_reason' IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'verified capture and settlement did not issue a paid order';
    ELSIF n = 2 AND (
      outcome #>> '{receipt,status}' IS DISTINCT FROM 'review_required'
      OR outcome #>> '{receipt,review_reason}' IS DISTINCT FROM 'ORDER_REVIEW_REQUIRED'
      OR outcome #>> '{receipt,order_id}' IS NOT NULL
      OR outcome->>'hold_reason' IS DISTINCT FROM 'ORDER_REVIEW_REQUIRED'
    ) THEN
      RAISE EXCEPTION 'price drift lost paid evidence or issued an order';
    END IF;
    IF outcome IS DISTINCT FROM public.reconcile_verified_partner_order(submission_id, merchant_id, connection_id, evidence, proof) THEN
      RAISE EXCEPTION 'evidence replay changed the resulting order or hold';
    END IF;
  END LOOP;
END;
$$;

RESET ROLE;
DO $$
DECLARE
  held private.partner_order_submissions%ROWTYPE;
BEGIN
  SELECT * INTO STRICT held FROM private.partner_order_submissions AS s
  WHERE s.partner_order_id = 'external-2';
  UPDATE public.partner_writer_fixture_products SET base_price = 100
  WHERE id = '40000000-0000-4000-8000-000000000002';
  BEGIN
    PERFORM private.accept_settled_partner_order(held.id, held.merchant_id, held.connection_id);
    RAISE EXCEPTION 'order accepted after price changed back without resolving hold';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'partner_order_requires_review' THEN RAISE; END IF;
  END;
  IF private.partner_order_receipt(held)->>'status' IS DISTINCT FROM 'review_required' THEN
    RAISE EXCEPTION 'reloading the receipt lost its review hold';
  END IF;

  IF (SELECT count(*) FROM public.orders WHERE payment_status = 'paid') <> 1
     OR (SELECT count(*) FROM public.transactions WHERE status = 'completed') <> 1
     OR (SELECT count(*) FROM private.partner_payment_captures) <> 2
     OR (SELECT count(*) FROM private.partner_order_settlements) <> 2
     OR (SELECT stock FROM public.partner_writer_fixture_products
         WHERE id = '40000000-0000-4000-8000-000000000002') <> 10 THEN
    RAISE EXCEPTION 'complete or held flow produced inconsistent order, ledger, or inventory state';
  END IF;
END;
$$;

ROLLBACK;
