-- Preserve a server-authored transaction-discount marker when an authenticated
-- attribution update omits the marker from its replacement ad_tracking object.
-- The marker is historical financial provenance and may only be replaced by the
-- guarded admin-edit path or a newly authenticated storefront proof.
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
  v_payload_hash text;
  v_inserted_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id
       AND pg_catalog.jsonb_typeof(OLD.ad_tracking) = 'object'
       AND OLD.ad_tracking ? 'baci_transaction_discount'
       AND (
         pg_catalog.jsonb_typeof(v_tracking) <> 'object'
         OR NOT (v_tracking ? 'baci_transaction_discount')
       ) THEN
      NEW.ad_tracking := (
        CASE
          WHEN pg_catalog.jsonb_typeof(v_tracking) = 'object'
            THEN v_tracking
          ELSE '{}'::jsonb
        END
      ) || jsonb_build_object(
        'baci_transaction_discount',
        OLD.ad_tracking -> 'baci_transaction_discount'
      );
      RETURN NEW;
    END IF;
  END IF;

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

  -- Legacy v2 metadata is unsigned but already persisted by the old checkout
  -- path. Preserve it only when an attribution update carries the exact same
  -- marker from OLD; modified or newly introduced v2 markers are stripped.
  IF TG_OP = 'UPDATE'
     AND NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id
     AND pg_catalog.jsonb_typeof(v_metadata) = 'object'
     AND v_metadata ->> 'version' = '2'
     AND pg_catalog.jsonb_typeof(OLD.ad_tracking) = 'object'
     AND OLD.ad_tracking -> 'baci_transaction_discount' = v_metadata THEN
    RETURN NEW;
  END IF;

  v_proof := CASE
    WHEN pg_catalog.jsonb_typeof(v_metadata) = 'object'
      THEN v_metadata -> 'proof'
    ELSE NULL
  END;
  v_payload_hash := v_proof ->> 'payload_hash';

  IF pg_catalog.jsonb_typeof(v_metadata) = 'object'
     AND v_metadata ->> 'version' = '3'
     AND pg_catalog.jsonb_typeof(v_proof) = 'object'
     AND NULLIF(v_proof ->> 'proof_id', '') IS NOT NULL
     AND NULLIF(v_proof ->> 'signature', '') IS NOT NULL
     AND v_proof ->> 'proof_id' = pg_catalog.left(v_proof ->> 'signature', 24)
     AND v_proof -> 'payload' = (v_metadata - 'proof')
     AND v_payload_hash =
       private.transaction_discount_payload_hash(v_proof -> 'payload') THEN
    -- Replay is allowed only for the same order, merchant, and originally
    -- authenticated payload. HMAC verification happens below for new proofs.
    IF EXISTS (
      SELECT 1
      FROM private.transaction_discount_proof_replay AS replay
      WHERE replay.proof_id = v_proof ->> 'signature'
        AND replay.order_id = NEW.id
        AND replay.merchant_id = NEW.merchant_id
        AND replay.payload_hash = v_payload_hash
    ) THEN
      RETURN NEW;
    END IF;

    IF public.quiz_route_proof_valid(
      v_proof,
      'storefront_transaction_discount',
      NEW.merchant_id::text,
      NULL
    ) THEN
      INSERT INTO private.transaction_discount_proof_replay AS replay (
        proof_id,
        order_id,
        merchant_id,
        payload_hash
      ) VALUES (
        v_proof ->> 'signature',
        NEW.id,
        NEW.merchant_id,
        v_payload_hash
      )
      ON CONFLICT (proof_id) DO UPDATE
      SET payload_hash = COALESCE(replay.payload_hash, EXCLUDED.payload_hash)
      WHERE replay.order_id = EXCLUDED.order_id
        AND replay.merchant_id = EXCLUDED.merchant_id;
      GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
      IF EXISTS (
        SELECT 1
        FROM private.transaction_discount_proof_replay AS replay
        WHERE replay.proof_id = v_proof ->> 'signature'
          AND replay.order_id = NEW.id
          AND replay.merchant_id = NEW.merchant_id
          AND replay.payload_hash = v_payload_hash
      ) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  -- Version 3 is the route's server-derived negotiated-discount contract. A
  -- present proof key means the route attempted to authorize a discount; do
  -- not create or update the order after any proof, secret, expiry, or replay
  -- failure.
  IF pg_catalog.jsonb_typeof(v_metadata) = 'object'
     AND v_metadata ->> 'version' = '3'
     AND v_metadata ? 'proof' THEN
    RAISE EXCEPTION 'transaction_discount_proof_rejected';
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

COMMENT ON FUNCTION private.sanitize_storefront_transaction_discount_metadata()
  IS 'Preserves existing transaction discount provenance across same-merchant attribution updates, accepts guarded proofs and admin edits, and strips forged markers.';
