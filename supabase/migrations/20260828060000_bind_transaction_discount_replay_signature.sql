-- The replay ledger must be keyed by the authenticated HMAC, not by the
-- caller-controlled proof_id field. The signature covers the complete proof
-- context and payload hash, so changing proof_id cannot mint a new replay key.
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
  v_inserted_count integer;
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
     AND NULLIF(v_proof ->> 'proof_id', '') IS NOT NULL
     AND v_proof ->> 'proof_id' = pg_catalog.left(v_proof ->> 'signature', 24)
     AND v_proof -> 'payload' = (v_metadata - 'proof')
     AND v_proof ->> 'payload_hash' =
       private.transaction_discount_payload_hash(v_proof -> 'payload')
     AND public.quiz_route_proof_valid(
       v_proof,
       'storefront_transaction_discount',
       NEW.merchant_id::text,
       NULL
     ) THEN
    INSERT INTO private.transaction_discount_proof_replay (
      proof_id,
      order_id,
      merchant_id
    ) VALUES (
      v_proof ->> 'signature',
      NEW.id,
      NEW.merchant_id
    )
    ON CONFLICT (proof_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    IF v_inserted_count = 1 THEN
      RETURN NEW;
    END IF;
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
REVOKE ALL ON FUNCTION private.sanitize_storefront_transaction_discount_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON COLUMN private.transaction_discount_proof_replay.proof_id IS
  'Authenticated storefront proof signature used as the one-time replay key; column name retained for migration compatibility.';
