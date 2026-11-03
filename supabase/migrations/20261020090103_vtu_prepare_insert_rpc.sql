-- Service-role-only prepare-INSERT for the wallet-only checkout
-- (epic #3694 Phase 2).
--
-- There is deliberately NO buyer INSERT policy on
-- vtu_transactions: fulfillment credits row money columns, and a
-- direct-INSERT policy would let buyers forge rows (Rev 2 re-review:
-- forged cashback + a forged cron marker = mint). There is
-- deliberately no authenticated EXECUTE on this RPC either (Codex
-- P1, PR #3741): the settlement payload (source, commissions,
-- cashback, metadata payment split) is server-computed by the
-- route — the commerce calc is an external service call the RPC
-- cannot reproduce — so any authenticated grant would let buyers
-- forge gift-sourced (no-debit vend) or cashback-inflated rows and
-- fulfill them through claim + replay. Only the route's privileged
-- client calls it, with server-computed values.
--
-- Defense in depth: status is pinned to pending, source must be
-- 'checkout' (this RPC serves the wallet-only checkout only), and
-- amount must be positive — all fail closed even for privileged
-- callers. The RETURNING shape matches
-- preparePendingVtuTransaction's select exactly (id, amount,
-- customer_identifier, metadata, request_reference, status, type).

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

  -- This RPC serves the wallet-only checkout only: any other
  -- source (gift/loyalty/direct) follows a different settlement
  -- path and must never be minted here (Codex P1 forge).
  IF p_source IS DISTINCT FROM 'checkout' THEN
    RAISE EXCEPTION 'invalid_arguments: insert_prepared_vtu_transaction requires source checkout';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_arguments: insert_prepared_vtu_transaction requires a positive amount';
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
) TO service_role;

COMMENT ON FUNCTION public.insert_prepared_vtu_transaction(
  uuid, uuid, uuid, uuid, text, text, text, numeric, text, text,
  numeric, numeric, numeric, text, text, text, text, jsonb
) IS
  'Phase 2 (#3694): service-role-only VTU prepare-INSERT. Status pinned pending, source pinned checkout, amount positive. No buyer INSERT policy and no authenticated EXECUTE exist by design (mint hole).';
