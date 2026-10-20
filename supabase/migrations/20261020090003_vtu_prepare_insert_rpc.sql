-- Ownership-verified prepare-INSERT for the wallet-only
-- checkout (epic #3694 Phase 2).
--
-- There is deliberately NO buyer INSERT policy on
-- vtu_transactions: fulfillment credits row money columns, and a
-- direct-INSERT policy would let buyers forge rows (Rev 2 re-review:
-- forged cashback + a forged cron marker = mint). The checkout
-- inserts through this RPC instead, which verifies the target
-- customer is the caller's own row and then inserts the full
-- prepared payload — including money columns — in one allowlisted
-- write. Status is pinned to pending server-side; the RETURNING
-- shape matches preparePendingVtuTransaction's select exactly
-- (id, amount, customer_identifier, metadata, request_reference,
-- status, type).

CREATE OR REPLACE FUNCTION public.insert_prepared_vtu_transaction(
  p_merchant_id uuid,
  p_customer_id uuid,
  p_user_id uuid,
  p_order_id uuid,
  p_type text,
  p_network_provider text,
  p_phone_number text,
  p_amount numeric,
  p_request_reference text,
  p_source text,
  p_platform_commission numeric,
  p_merchant_commission numeric,
  p_customer_cashback numeric,
  p_biller_name text,
  p_biller_item_code text,
  p_customer_identifier text,
  p_customer_name text,
  p_metadata jsonb
)
RETURNS TABLE (
  id uuid,
  amount numeric,
  customer_identifier text,
  metadata jsonb,
  request_reference text,
  status text,
  type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_row public.vtu_transactions%ROWTYPE;
BEGIN
  IF p_merchant_id IS NULL
    OR p_customer_id IS NULL
    OR p_user_id IS NULL
    OR p_type IS NULL
    OR p_network_provider IS NULL
    OR p_phone_number IS NULL
    OR p_amount IS NULL
    OR p_request_reference IS NULL
    OR p_source IS NULL
  THEN
    RAISE EXCEPTION 'invalid_arguments: insert_prepared_vtu_transaction requires merchant, customer, user, type, network, phone, amount, reference, source';
  END IF;

  -- Ownership: the target customer must be the caller's own row.
  v_owner :=
    public._vtu_checkout_caller_customer(p_merchant_id, p_user_id);
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'not authorized: customer scope mismatch';
  END IF;

  INSERT INTO public.vtu_transactions (
    merchant_id, customer_id, order_id, type, network_provider,
    phone_number, amount, request_reference, status, source,
    platform_commission, merchant_commission, customer_cashback,
    biller_name, biller_item_code, customer_identifier,
    customer_name, metadata
  )
  VALUES (
    p_merchant_id, p_customer_id, p_order_id, p_type, p_network_provider,
    p_phone_number, p_amount, p_request_reference, 'pending', p_source,
    p_platform_commission, p_merchant_commission, p_customer_cashback,
    p_biller_name, p_biller_item_code, p_customer_identifier,
    p_customer_name, p_metadata
  )
  RETURNING * INTO v_row;

  id := v_row.id;
  amount := v_row.amount;
  customer_identifier := v_row.customer_identifier;
  metadata := v_row.metadata;
  request_reference := v_row.request_reference;
  status := v_row.status;
  type := v_row.type;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_prepared_vtu_transaction(
  uuid, uuid, uuid, uuid, text, text, text, numeric, text, text,
  numeric, numeric, numeric, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_prepared_vtu_transaction(
  uuid, uuid, uuid, uuid, text, text, text, numeric, text, text,
  numeric, numeric, numeric, text, text, text, text, jsonb
) TO authenticated, service_role;

COMMENT ON FUNCTION public.insert_prepared_vtu_transaction(
  uuid, uuid, uuid, uuid, text, text, text, numeric, text, text,
  numeric, numeric, numeric, text, text, text, text, jsonb
) IS
  'Phase 2 (#3694): ownership-verified VTU prepare-INSERT. Status pinned pending. Replaces the buyer INSERT policy that must never exist (mint hole).';
