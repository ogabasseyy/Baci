-- Extends receipt-claim previews with the manual document kind so invoice
-- claim pages render invoice copy. Import claims (no manual notification)
-- keep the default receipt presentation.
CREATE OR REPLACE FUNCTION private.preview_receipt_claim(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim public.receipt_claims%ROWTYPE;
  v_merchant jsonb;
  v_orders jsonb;
  v_document_kind text := 'receipt';
BEGIN
  SELECT rc.* INTO v_claim
  FROM public.receipt_claims AS rc
  WHERE rc.token_hash = p_token_hash
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'business_name', m.business_name,
    'slug', m.slug
  )
  INTO v_merchant
  FROM public.merchants AS m
  WHERE m.id = v_claim.merchant_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'order_items', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'name', oi.name,
                'quantity', oi.quantity
              )
              ORDER BY oi.created_at NULLS LAST, oi.id
            )
            FROM public.order_items AS oi
            WHERE oi.order_id = o.id
          ),
          '[]'::jsonb
        )
      )
      ORDER BY o.created_at NULLS LAST, o.id
    ),
    '[]'::jsonb
  )
  INTO v_orders
  FROM public.receipt_claim_orders AS rco
  JOIN public.orders AS o
    ON o.id = rco.order_id
  WHERE rco.receipt_claim_id = v_claim.id;

  IF v_claim.manual_notification_id IS NOT NULL THEN
    SELECT COALESCE(
      (
        SELECT CASE WHEN n.event_type = 'manual_order_invoice' THEN 'invoice' ELSE 'receipt' END
        FROM public.order_notification_outbox AS n
        WHERE n.id = v_claim.manual_notification_id
      ),
      'receipt'
    )
    INTO v_document_kind;
  END IF;

  RETURN jsonb_build_object(
    'id', v_claim.id,
    'merchant_id', v_claim.merchant_id,
    'customer_id', v_claim.customer_id,
    'customer_email', v_claim.customer_email,
    'customer_name', v_claim.customer_name,
    'expires_at', v_claim.expires_at,
    'claimed_at', v_claim.claimed_at,
    'claimed_by_user_id', v_claim.claimed_by_user_id,
    'document_kind', v_document_kind,
    'merchant', v_merchant,
    'orders', v_orders
  );
END;
$$;
-- Anonymous claim-link previews execute this SECURITY DEFINER function as
-- anon (logged out) or authenticated; state the posture explicitly instead
-- of relying on the default PUBLIC execute grant.
REVOKE ALL ON FUNCTION private.preview_receipt_claim(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.preview_receipt_claim(text)
  TO anon, authenticated, service_role;
