-- File REDVAULT inventory-confirmation reviews without the admin client.
-- The user-facing verify flow files serialized_inventory_confirmation_failed
-- reviews when capture evidence needs review. Doing that insert through
-- createAdminClient() lets a shopper-triggered call graph bypass RLS with an
-- unrestricted service-role client. This narrowly scoped RPC accepts the same
-- callers as the other REDVAULT scoped primitives (service_role or the
-- merchant-bound storefront route client), pins the row to the REDVAULT
-- merchant and the serialized inventory issue type server-side, and folds a
-- duplicate open review into a duplicate:true receipt instead of raising.
CREATE OR REPLACE FUNCTION public.file_uba_redvault_inventory_confirmation_review(
  p_order_id uuid,
  p_transaction_id uuid DEFAULT NULL,
  p_gateway_reference text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
  v_order public.orders%ROWTYPE;
  v_reason text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
    AND NOT ((SELECT auth.role()) = 'authenticated'
      AND v_claims->>'storefront_order_context' = 'route'
      AND v_claims->>'storefront_order_merchant_id' = '6b5cb8a4-5575-456c-b936-8cdfae30db74') THEN
    RAISE EXCEPTION 'forbidden: file_uba_redvault_inventory_confirmation_review requires service_role or scoped route context';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'redvault_review_invalid_arguments';
  END IF;
  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'redvault_review_reason_invalid';
  END IF;
  IF jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'redvault_review_metadata_invalid';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND
    OR v_order.merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    OR v_order.payment_method IS DISTINCT FROM 'uba_redvault' THEN
    RAISE EXCEPTION 'redvault_review_order_mismatch';
  END IF;
  IF p_merchant_id IS NOT NULL AND p_merchant_id IS DISTINCT FROM v_order.merchant_id THEN
    RAISE EXCEPTION 'redvault_review_order_mismatch';
  END IF;
  IF p_transaction_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.transactions
                    WHERE id = p_transaction_id AND order_id = p_order_id) THEN
    RAISE EXCEPTION 'redvault_review_transaction_mismatch';
  END IF;
  BEGIN
    INSERT INTO public.reconciliation_review
      (issue_type, merchant_id, order_id, paystack_ref, reason, txn_id, candidates, metadata)
    VALUES
      ('serialized_inventory_confirmation_failed', v_order.merchant_id, p_order_id,
       NULLIF(trim(COALESCE(p_gateway_reference, '')), ''), v_reason, p_transaction_id, NULL,
       COALESCE(p_metadata, '{}'::jsonb));
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('filed', false, 'duplicate', true, 'orderId', p_order_id);
  END;
  RETURN jsonb_build_object('filed', true, 'duplicate', false, 'orderId', p_order_id);
END;
$$;
ALTER FUNCTION public.file_uba_redvault_inventory_confirmation_review(uuid, uuid, text, text, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.file_uba_redvault_inventory_confirmation_review(uuid, uuid, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.file_uba_redvault_inventory_confirmation_review(uuid, uuid, text, text, uuid, jsonb)
  TO service_role, authenticated;
