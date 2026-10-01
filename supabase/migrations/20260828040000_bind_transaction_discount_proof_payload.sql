-- The route-proof HMAC authenticates the payload hash, while the proof
-- verifier must also bind that hash to the payload stored beside the order.
-- PostgreSQL jsonb output is not a compact canonical representation, so keep
-- the same sorted-key, array-order JSON serialization used by quiz-proof.ts.
CREATE OR REPLACE FUNCTION private.canonical_jsonb(p_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT CASE pg_catalog.jsonb_typeof(p_value)
    WHEN 'object' THEN
      '{' || COALESCE((
        SELECT pg_catalog.string_agg(
          pg_catalog.to_jsonb(entry.key)::text || ':' ||
            private.canonical_jsonb(entry.value),
          ',' ORDER BY entry.key
        )
        FROM pg_catalog.jsonb_each(p_value) AS entry
      ), '') || '}'
    WHEN 'array' THEN
      '[' || COALESCE((
        SELECT pg_catalog.string_agg(
          private.canonical_jsonb(entry.value),
          ',' ORDER BY entry.ordinality
        )
        FROM pg_catalog.jsonb_array_elements(p_value)
          WITH ORDINALITY AS entry(value, ordinality)
      ), '') || ']'
    WHEN 'string' THEN pg_catalog.to_jsonb(p_value #>> '{}')::text
    WHEN 'number' THEN p_value::text
    WHEN 'boolean' THEN p_value::text
    WHEN 'null' THEN 'null'
  END;
$$;

ALTER FUNCTION private.canonical_jsonb(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.canonical_jsonb(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.transaction_discount_payload_hash(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(private.canonical_jsonb(p_payload), 'sha256'),
    'hex'
  );
$$;

ALTER FUNCTION private.transaction_discount_payload_hash(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.transaction_discount_payload_hash(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.sanitize_storefront_transaction_discount_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tracking jsonb := NEW.ad_tracking;
  v_metadata jsonb;
  v_proof jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(v_tracking) <> 'object'
     OR NOT (v_tracking ? 'baci_transaction_discount') THEN
    RETURN NEW;
  END IF;

  v_metadata := v_tracking -> 'baci_transaction_discount';

  IF pg_catalog.jsonb_typeof(v_metadata) = 'object'
     AND v_metadata ->> 'status' = 'admin_edit'
     AND v_metadata ->> 'version' = '4'
     AND EXISTS (
       SELECT 1
       FROM private.transaction_discount_admin_edit_context AS context
       WHERE context.transaction_id = pg_catalog.txid_current()
         AND context.order_id = NEW.id
     ) THEN
    RETURN NEW;
  END IF;

  v_proof := CASE
    WHEN pg_catalog.jsonb_typeof(v_metadata) = 'object'
      THEN v_metadata -> 'proof'
    ELSE NULL
  END;

  IF pg_catalog.jsonb_typeof(v_metadata) = 'object'
     AND v_metadata ->> 'version' = '3'
     AND pg_catalog.jsonb_typeof(v_proof) = 'object'
     AND v_proof -> 'payload' = (v_metadata - 'proof')
     AND v_proof ->> 'payload_hash' =
       private.transaction_discount_payload_hash(v_proof -> 'payload')
     AND public.quiz_route_proof_valid(
       v_proof,
       'storefront_transaction_discount',
       NEW.merchant_id::text,
       NULL
     ) THEN
    RETURN NEW;
  END IF;

  NEW.ad_tracking := NULLIF(
    v_tracking - 'baci_transaction_discount',
    '{}'::jsonb
  );
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.sanitize_storefront_transaction_discount_metadata()
  OWNER TO postgres;
