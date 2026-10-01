-- Both the legacy and channel-aware public routes use live, verified identity.
-- Reusing the existing v2 core preserves click/channel tracking and same-user replay.
CREATE OR REPLACE FUNCTION private.redeem_verified_receipt_claim(
  p_token_hash text, p_source text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_verified_at timestamptz;
  v_claim public.receipt_claims%ROWTYPE;
  v_customer public.customers%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('status', 'unauthorized'); END IF;
  SELECT lower(btrim(u.email)), u.email_confirmed_at INTO v_email, v_verified_at
  FROM auth.users AS u WHERE u.id = v_user_id AND u.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unauthorized'); END IF;
  IF v_verified_at IS NULL THEN RETURN jsonb_build_object('status', 'email_unverified'); END IF;
  IF COALESCE(v_email, '') = ''
    OR v_email IS DISTINCT FROM lower(btrim(COALESCE(auth.jwt()->>'email', ''))) THEN
    RETURN jsonb_build_object('status', 'email_mismatch');
  END IF;
  SELECT rc.* INTO v_claim FROM public.receipt_claims AS rc
  WHERE rc.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF v_claim.expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  IF v_claim.customer_email_normalized IS DISTINCT FROM v_email THEN
    RETURN jsonb_build_object('status', 'email_mismatch');
  END IF;
  SELECT c.* INTO v_customer FROM public.customers AS c
  WHERE c.id = v_claim.customer_id AND c.merchant_id = v_claim.merchant_id
    AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'customer_link_failed'); END IF;
  IF lower(btrim(v_customer.email)) IS DISTINCT FROM v_email THEN
    RETURN jsonb_build_object('status', 'email_mismatch');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.receipt_claim_orders WHERE receipt_claim_id = v_claim.id)
    OR EXISTS (
      SELECT 1 FROM public.receipt_claim_orders AS rco JOIN public.orders AS o ON o.id = rco.order_id
      WHERE rco.receipt_claim_id = v_claim.id
        AND (o.merchant_id IS DISTINCT FROM v_claim.merchant_id
          OR o.customer_id IS DISTINCT FROM v_claim.customer_id)
    ) THEN RETURN jsonb_build_object('status', 'customer_link_failed'); END IF;
  RETURN private.redeem_receipt_claim_v2(p_token_hash, p_source);
END;
$$;
REVOKE ALL ON FUNCTION private.redeem_verified_receipt_claim(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.redeem_verified_receipt_claim(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_receipt_claim_v2(p_token_hash text, p_source text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.redeem_verified_receipt_claim(p_token_hash, p_source);
$$;
CREATE OR REPLACE FUNCTION public.redeem_receipt_claim(p_token_hash text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.redeem_verified_receipt_claim(p_token_hash, 'web');
$$;
REVOKE ALL ON FUNCTION private.redeem_receipt_claim_v2(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.redeem_receipt_claim(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_receipt_claim_v2(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_receipt_claim(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_receipt_claim_v2(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_receipt_claim(text) TO authenticated;
