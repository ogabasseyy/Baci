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
    --
    -- A marked row whose outbox row is gone (deleted/recreated around a
    -- resend) resolves to NULL, which the loader surfaces as 'unknown',
    -- instead of asserting 'receipt' for a document that may never have
    -- been sent.
    SELECT (
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
            -- Mirror resolveInvoiceTypeCode exactly: an explicit stored
            -- 325 stays proforma like the sender emits even with partial
            -- or credited payment; the amount/status gates apply only to
            -- the implicit invoice-method default-380 branch.
            AND (nullif(btrim(o.invoice_type_code), '') = '325'
              OR (regexp_replace(lower(btrim(COALESCE(o.payment_status, ''))), '\s+', '_', 'g') IS DISTINCT FROM 'partially_paid'
                AND COALESCE(o.amount_paid, 0) <= 0
                AND lower(btrim(o.payment_method)) = 'invoice'
                AND COALESCE(nullif(btrim(o.invoice_type_code), ''), '380') = '380'))
          THEN 'proforma_invoice'
          WHEN n.event_type = 'manual_order_invoice' THEN 'invoice'
          ELSE 'receipt'
        END
        FROM public.order_notification_outbox AS n
        JOIN public.orders AS o ON o.id = n.order_id
        WHERE n.id = v_claim.manual_notification_id
      )
    INTO v_document_kind;
  END IF;

  -- The anon-facing payload carries only what the claim UI renders:
  -- top-level customer/merchant UUIDs, the redeemer id, and the recipient
  -- email are consumed by no anon caller, so they stay out of the directly
  -- invocable anon surface. The login-hint email lives behind the
  -- service-role-only get_receipt_claim_login_hint below and reaches the
  -- client solely through the token-scoped login-email route.
  RETURN jsonb_build_object(
    'id', v_claim.id,
    'customer_name', v_claim.customer_name,
    'expires_at', v_claim.expires_at,
    'claimed_at', v_claim.claimed_at,
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
-- Server-only login-hint email. The anon preview payload above no longer
-- carries customer_email, so the token-scoped login-email route fetches it
-- here through the service-role key. Granted to service_role only: direct
-- PostgREST callers can never reach the raw recipient address, while the
-- bearer token remains the only credential the server needs.
CREATE OR REPLACE FUNCTION private.get_receipt_claim_login_hint(p_token_hash text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_expires_at timestamptz;
BEGIN
  SELECT rc.customer_email, rc.expires_at INTO v_email, v_expires_at
  FROM public.receipt_claims AS rc
  WHERE rc.token_hash = p_token_hash
  LIMIT 1;
  IF NOT FOUND THEN
    SELECT rc.customer_email, rc.expires_at INTO v_email, v_expires_at
    FROM public.receipt_claims AS rc
    WHERE rc.previous_token_hash = p_token_hash
    LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    SELECT rc.customer_email, rc.expires_at INTO v_email, v_expires_at
    FROM public.receipt_claims AS rc
    WHERE rc.delivered_token_hash = p_token_hash
    LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_expires_at IS NOT NULL AND v_expires_at <= now() THEN
    RETURN NULL;
  END IF;
  RETURN v_email;
END;
$$;
CREATE OR REPLACE FUNCTION public.get_receipt_claim_login_hint(p_token_hash text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT private.get_receipt_claim_login_hint(p_token_hash); $$;
-- Revoke the API roles explicitly, not just PUBLIC: baseline images may
-- hold direct anon/authenticated grants that a PUBLIC-only revoke leaves
-- in place, which would expose the raw recipient address to PostgREST.
REVOKE ALL ON FUNCTION private.get_receipt_claim_login_hint(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_receipt_claim_login_hint(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_receipt_claim_login_hint(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receipt_claim_login_hint(text)
  TO service_role;
