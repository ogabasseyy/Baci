-- Replay bindings should be reclaimed by the order-delete trigger without
-- making ordinary order writes scan the historical ledger.
DO $$
DECLARE
  v_order_id uuid;
  v_merchant_id uuid;
  v_proof_id text := format('replay-cleanup-%s', txid_current());
BEGIN
  SELECT oi.order_id, o.merchant_id
  INTO v_order_id, v_merchant_id
  FROM public.order_items AS oi
  JOIN public.orders AS o ON o.id = oi.order_id
  LIMIT 1;

  INSERT INTO private.transaction_discount_proof_replay (
    proof_id,
    order_id,
    merchant_id
  ) VALUES (v_proof_id, v_order_id, v_merchant_id);

  DELETE FROM public.orders
  WHERE id = v_order_id;

  IF EXISTS (
    SELECT 1
    FROM private.transaction_discount_proof_replay
    WHERE proof_id = v_proof_id
  ) THEN
    RAISE EXCEPTION
      'order deletion left a transaction discount replay binding';
  END IF;
END;
$$ LANGUAGE plpgsql;
