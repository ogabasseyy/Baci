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
    -- Previous-token grace, mirroring redemption: a mailed link from the
    -- attempt before a retry rotation still previews.
    SELECT rc.* INTO v_claim
    FROM public.receipt_claims AS rc
    WHERE rc.previous_token_hash = p_token_hash
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    -- Delivered-token retention, mirroring redemption: an accepted
    -- mail's link survives rejected corrective rotations.
    SELECT rc.* INTO v_claim
    FROM public.receipt_claims AS rc
    WHERE rc.delivered_token_hash = p_token_hash
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- The RPC is directly invocable via PostgREST, so the loader's 410 check
  -- alone cannot hide an expired claim. Return a non-sensitive sentinel
  -- instead of NULL so the documented expired-link (410) contract survives
  -- while identity, merchant, and order details stay hidden.
  IF v_claim.expires_at IS NOT NULL AND v_claim.expires_at <= now() THEN
    RETURN jsonb_build_object('expired', true);
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
    -- A marked row shows the kind the sender snapshotted at dispatch, so a
    -- later payment cannot rewrite the preview away from the sent
    -- attachment. Unmarked rows (never dispatched, or reset after a
    -- definite rejection) fall back to the live rule below, which mirrors
    -- the sender's proforma rule (resolveInvoiceTypeCode with
    -- wasPaid=false): an unpaid, invoice-method order with no accepted
    -- payment and no explicit stored code previews as proforma.
    SELECT COALESCE(
      (
        SELECT CASE
          WHEN n.dispatch_started_at IS NOT NULL
            AND n.metadata->>'sent_document_kind' IN ('receipt', 'invoice', 'proforma_invoice')
          THEN n.metadata->>'sent_document_kind'
          WHEN n.event_type = 'manual_order_invoice'
            -- The status column is unconstrained: normalize exactly like
            -- the enqueue trigger and sender (trim, lowercase, fold
            -- internal whitespace) or 'Partially Paid' previews as
            -- proforma while the sender renders an invoice.
            AND regexp_replace(lower(btrim(COALESCE(o.payment_status, ''))), '\s+', '_', 'g') IS DISTINCT FROM 'paid'
            AND regexp_replace(lower(btrim(COALESCE(o.payment_status, ''))), '\s+', '_', 'g') IS DISTINCT FROM 'partially_paid'
            AND COALESCE(o.amount_paid, 0) <= 0
            -- Mirror resolveInvoiceTypeCode: an explicit stored 325 stays
            -- proforma on any method, like the sender emits.
            AND (lower(btrim(o.payment_method)) = 'invoice'
              AND COALESCE(nullif(btrim(o.invoice_type_code), ''), '380') = '380'
              OR nullif(btrim(o.invoice_type_code), '') = '325')
          THEN 'proforma_invoice'
          WHEN n.event_type = 'manual_order_invoice' THEN 'invoice'
          ELSE 'receipt'
        END
        FROM public.order_notification_outbox AS n
        JOIN public.orders AS o ON o.id = n.order_id
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
-- The public wrapper delegates directly to the private implementation, so it
-- must also run as the owner: authenticated callers have no USAGE on schema
-- private (delegates boundary), and an INVOKER wrapper 42501s for signed-in
-- claim-link opens before automatic redemption can run.
ALTER FUNCTION public.preview_receipt_claim(text) SECURITY DEFINER;
