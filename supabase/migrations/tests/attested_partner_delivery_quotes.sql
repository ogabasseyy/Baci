-- Disposable database with the shipping quote proof verifier and a fixture Vault secret.
BEGIN;

CREATE FUNCTION pg_temp.partner_quote_proof(
  quote_id uuid, merchant_id uuid, connection_id text, expiry timestamptz,
  snapshot jsonb, issued_at text DEFAULT now()::text
)
RETURNS jsonb LANGUAGE sql AS $$
  WITH payload AS (
    SELECT jsonb_build_object(
      'connection_id', connection_id, 'expires_at', expiry, 'snapshot', snapshot
    )::text AS value
  )
  SELECT jsonb_build_object(
    'version', 'baci-shipping-quote-proof:v1',
    'action', 'persist_partner_delivery_quote',
    'merchant_id', merchant_id,
    'subject_id', quote_id,
    'issued_at', issued_at,
    'payload_text', payload.value,
    'signature', encode(extensions.hmac(
      concat_ws(E'\n', 'baci:shipping-quote-rpc:v1', 'baci-shipping-quote-proof:v1',
        'persist_partner_delivery_quote', quote_id, merchant_id, issued_at, payload.value),
      'fixture-partner-quote-proof-secret', 'sha256'
    ), 'hex')
  ) FROM payload;
$$;

INSERT INTO public.merchants (id)
VALUES ('10000000-0000-4000-8000-000000000001');

SET LOCAL ROLE anon;
DO $$
DECLARE
  merchant_id constant uuid := '10000000-0000-4000-8000-000000000001';
  quote_id constant uuid := '20000000-0000-4000-8000-000000000001';
  connection_id constant text := 'fixture-connection';
  expiry constant timestamptz := now() + interval '10 minutes';
  snapshot constant jsonb := '{"delivery_minor":100000,"currency":"NGN"}';
  proof constant jsonb := pg_temp.partner_quote_proof(quote_id, merchant_id, connection_id, expiry, snapshot);
BEGIN
  IF has_table_privilege(current_user, (
    SELECT c.oid FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private' AND c.relname = 'partner_delivery_quotes'
  ), 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'partner quote table accessible to caller';
  END IF;

  IF public.persist_partner_delivery_quote(quote_id, merchant_id, connection_id, expiry, snapshot, proof)
       IS DISTINCT FROM quote_id
     OR public.persist_partner_delivery_quote(quote_id, merchant_id, connection_id, expiry, snapshot, proof)
       IS DISTINCT FROM quote_id THEN
    RAISE EXCEPTION 'signed replay did not return the original quote';
  END IF;

  BEGIN
    PERFORM public.persist_partner_delivery_quote(quote_id, merchant_id, 'other-connection', expiry, snapshot, proof);
    RAISE EXCEPTION 'connection substitution accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.persist_partner_delivery_quote(
      quote_id, '10000000-0000-4000-8000-000000000002', connection_id, expiry, snapshot, proof
    );
    RAISE EXCEPTION 'merchant substitution accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.persist_partner_delivery_quote(
      quote_id, merchant_id, connection_id, expiry, snapshot || '{"delivery_minor":0}', proof
    );
    RAISE EXCEPTION 'snapshot substitution accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.persist_partner_delivery_quote(quote_id, merchant_id, connection_id, expiry, snapshot, NULL);
    RAISE EXCEPTION 'unsigned quote accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.persist_partner_delivery_quote(quote_id, merchant_id, connection_id, now(), snapshot, proof);
    RAISE EXCEPTION 'expired quote accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.persist_partner_delivery_quote(
      quote_id, merchant_id, 'other-connection', expiry, snapshot,
      pg_temp.partner_quote_proof(quote_id, merchant_id, 'other-connection', expiry, snapshot)
    );
    RAISE EXCEPTION 'quote ID overwritten by a different signed connection';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM private.partner_delivery_quotes) <> 1 THEN
    RAISE EXCEPTION 'valid replay or rejected calls wrote extra quote rows';
  END IF;
END;
$$;
ROLLBACK;
