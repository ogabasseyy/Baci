-- Preserve an already accepted storefront discount proof when an order is
-- updated after the proof's short validation window. The metadata remains
-- bound to the original payload and order; only the expiry check is skipped
-- for this exact same-order replay.
CREATE INDEX IF NOT EXISTS transaction_discount_proof_replay_order_id_idx
  ON private.transaction_discount_proof_replay (order_id);

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
  -- Keep a proof binding for as long as its order exists. A later order
  -- update may legitimately replay the marker long after the short proof
  -- validation window; rows for deleted orders can still be reclaimed.
  DELETE FROM private.transaction_discount_proof_replay AS replay
  WHERE consumed_at < pg_catalog.now() - INTERVAL '1 day'
    AND NOT EXISTS (
      SELECT 1
      FROM public.orders AS order_row
      WHERE order_row.id = replay.order_id
    );

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
     AND NULLIF(v_proof ->> 'signature', '') IS NOT NULL
     AND v_proof ->> 'proof_id' = pg_catalog.left(v_proof ->> 'signature', 24)
     AND v_proof -> 'payload' = (v_metadata - 'proof')
     AND v_proof ->> 'payload_hash' =
       private.transaction_discount_payload_hash(v_proof -> 'payload') THEN
    -- An order update can legitimately replay the exact marker after the
    -- route proof's five-minute validity window has elapsed. The structural
    -- and payload-hash checks above prevent a caller from changing it.
    IF EXISTS (
      SELECT 1
      FROM private.transaction_discount_proof_replay AS replay
      WHERE replay.proof_id = v_proof ->> 'signature'
        AND replay.order_id = NEW.id
        AND replay.merchant_id = NEW.merchant_id
    ) THEN
      RETURN NEW;
    END IF;

    IF public.quiz_route_proof_valid(
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
      IF v_inserted_count = 1 OR EXISTS (
        SELECT 1
        FROM private.transaction_discount_proof_replay AS replay
        WHERE replay.proof_id = v_proof ->> 'signature'
          AND replay.order_id = NEW.id
          AND replay.merchant_id = NEW.merchant_id
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
  IS 'Keeps server-proven transaction discount metadata, accepts unchanged same-order replays, rejects failed proof acceptance, and strips forged public RPC payloads.';
