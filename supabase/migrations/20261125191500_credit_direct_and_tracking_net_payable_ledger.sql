-- Derive Credit Direct checkout amounts and guest tracking store-credit
-- projections from authoritative wallet/savings ledger rows as well as order
-- columns, matching the reversal- and status-filtered net-payable invariant.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.credit_direct_net_payable(
  p_order_id uuid,
  p_merchant_id uuid,
  p_total numeric,
  p_amount_paid numeric,
  p_wallet_used numeric,
  p_payment_status text
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet_redeemed numeric := 0;
  v_wallet_reversed numeric := 0;
  v_has_wallet_reversal boolean := false;
  v_wallet_ledger numeric := 0;
  v_effective_wallet numeric := 0;
  v_savings_ledger numeric := 0;
  v_pre_gateway_credit numeric := 0;
  v_payment_status text := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_payment_status)), ''),
    'unpaid'
  );
BEGIN
  IF p_total IS NULL
     OR p_total IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
    RETURN 0;
  END IF;

  SELECT
    COALESCE(SUM(GREATEST(t.amount, 0)) FILTER (
      WHERE t.source_type = 'order_redemption'
        AND t.type = 'redemption'
        AND t.status = 'completed'
    ), 0),
    COALESCE(SUM(GREATEST(t.amount, 0)) FILTER (
      WHERE t.source_type = 'order_reversal'
        AND t.status = 'completed'
    ), 0),
    COALESCE(BOOL_OR(
      t.source_type = 'order_reversal'
      AND t.status = 'completed'
    ), false)
    INTO v_wallet_redeemed, v_wallet_reversed, v_has_wallet_reversal
  FROM public.customer_wallet_transactions AS t
  WHERE t.source_id = p_order_id
    AND t.merchant_id = p_merchant_id
    AND t.source_type IN ('order_redemption', 'order_reversal');

  v_wallet_ledger := GREATEST(v_wallet_redeemed - v_wallet_reversed, 0);
  v_effective_wallet := CASE
    WHEN v_has_wallet_reversal THEN v_wallet_ledger
    ELSE GREATEST(COALESCE(p_wallet_used, 0), v_wallet_ledger, 0)
  END;

  SELECT COALESCE(SUM(GREATEST(r.amount, 0)), 0)
    INTO v_savings_ledger
  FROM public.customer_savings_redemptions AS r
  WHERE r.order_id = p_order_id
    AND r.merchant_id = p_merchant_id
    AND NOT (COALESCE(r.metadata, '{}'::jsonb) ? 'reversed_at');

  IF v_payment_status = 'partially_paid' THEN
    v_pre_gateway_credit := GREATEST(
      GREATEST(COALESCE(p_amount_paid, 0) - v_wallet_reversed, 0),
      v_effective_wallet + v_savings_ledger,
      0
    );
  ELSIF v_payment_status IN ('unpaid', 'pending')
     AND NOT v_has_wallet_reversal THEN
    v_pre_gateway_credit := GREATEST(
      COALESCE(p_amount_paid, 0),
      v_effective_wallet + v_savings_ledger,
      0
    );
  ELSE
    v_pre_gateway_credit := GREATEST(
      v_effective_wallet + v_savings_ledger,
      0
    );
  END IF;

  RETURN GREATEST(pg_catalog.round(p_total - v_pre_gateway_credit, 2), 0);
END;
$$;

ALTER FUNCTION private.credit_direct_net_payable(uuid, uuid, numeric, numeric, numeric, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.credit_direct_net_payable(uuid, uuid, numeric, numeric, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_credit_direct_checkout_token(
  p_order_id uuid,
  p_email text,
  p_merchant_id uuid,
  p_session_id text,
  p_tracking_token text
) RETURNS TABLE(checkout_token text, signed_amount numeric, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total numeric;
  v_amount_paid numeric;
  v_wallet_used numeric;
  v_shipping_status text;
  v_payment_status text;
  v_enabled boolean;
  v_min numeric;
  v_max numeric;
  v_amount numeric;
  v_token text;
  v_hash text;
  v_tracking_token text;
  v_expires timestamptz := pg_catalog.now() + interval '30 minutes';
BEGIN
  IF p_order_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  p_email := NULLIF(pg_catalog.btrim(COALESCE(p_email, '')), '');
  IF p_email IS NULL OR pg_catalog.length(p_email) > 254 THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  p_session_id := NULLIF(pg_catalog.btrim(COALESCE(p_session_id, '')), '');
  IF p_session_id IS NULL OR pg_catalog.length(p_session_id) > 200 THEN
    RAISE EXCEPTION 'invalid_session';
  END IF;

  v_tracking_token := NULLIF(pg_catalog.btrim(COALESCE(p_tracking_token, '')), '');
  IF v_tracking_token IS NULL OR pg_catalog.length(v_tracking_token) > 200 THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  SELECT o.total, o.amount_paid, o.wallet_amount_used,
         o.shipping_status, o.payment_status
    INTO v_total, v_amount_paid, v_wallet_used,
         v_shipping_status, v_payment_status
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.merchant_id = p_merchant_id
    AND pg_catalog.lower(o.customer_email) = pg_catalog.lower(p_email)
    AND o.tracking_token = v_tracking_token
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  SELECT s.credit_direct_enabled,
         COALESCE(s.credit_direct_min_amount, 10000),
         COALESCE(s.credit_direct_max_amount, 5000000)
    INTO v_enabled, v_min, v_max
  FROM public.merchant_feature_settings AS s
  WHERE s.merchant_id = p_merchant_id
  LIMIT 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'credit_direct_disabled';
  END IF;

  IF v_shipping_status = 'cancelled' THEN
    RAISE EXCEPTION 'order_not_payable';
  END IF;
  IF v_payment_status IS NULL
     OR v_payment_status NOT IN ('unpaid', 'pending', 'partially_paid', 'bnpl_pending') THEN
    RAISE EXCEPTION 'order_not_payable';
  END IF;

  v_amount := private.credit_direct_net_payable(
    p_order_id,
    p_merchant_id,
    v_total,
    v_amount_paid,
    v_wallet_used,
    v_payment_status
  );
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_order_amount';
  END IF;
  IF v_amount < v_min OR v_amount > v_max THEN
    RAISE EXCEPTION 'amount_out_of_range';
  END IF;

  DELETE FROM public.credit_direct_checkout_tokens
  WHERE order_id = p_order_id
    AND consumed_at IS NULL;

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := pg_catalog.encode(extensions.digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.credit_direct_checkout_tokens (
    token_hash, order_id, merchant_id, signed_amount, session_id, expires_at
  ) VALUES (
    v_hash, p_order_id, p_merchant_id, v_amount, p_session_id, v_expires
  );

  checkout_token := v_token;
  signed_amount := v_amount;
  expires_at := v_expires;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.issue_credit_direct_checkout_token(uuid, text, uuid, text, text)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION
  public.issue_credit_direct_checkout_token(uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_credit_direct_checkout_token(uuid, text, uuid, text, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_credit_direct_session(
  p_checkout_token text,
  p_order_id uuid,
  p_merchant_id uuid,
  p_session_id text,
  p_signed_amount numeric
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token_id uuid;
  v_token_order uuid;
  v_token_merchant uuid;
  v_token_session text;
  v_token_amount numeric;
  v_consumed_at timestamptz;
  v_expires_at timestamptz;
  v_hash text;
  v_consumed_count integer;
  v_raw_notes text;
  v_notes jsonb := '{}'::jsonb;
  v_superseded jsonb := '[]'::jsonb;
  v_total numeric;
  v_amount_paid numeric;
  v_wallet_used numeric;
  v_shipping_status text;
  v_payment_status text;
  v_enabled boolean;
  v_derived numeric;
  v_prev_txn text;
  v_prev_session text;
  v_completed_txn text;
  v_completed_session text;
BEGIN
  p_checkout_token := NULLIF(pg_catalog.btrim(COALESCE(p_checkout_token, '')), '');
  IF p_checkout_token IS NULL THEN
    RAISE EXCEPTION 'invalid_checkout_token';
  END IF;

  IF p_order_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'checkout_token_mismatch';
  END IF;

  p_session_id := NULLIF(pg_catalog.btrim(COALESCE(p_session_id, '')), '');
  IF p_session_id IS NULL OR pg_catalog.length(p_session_id) > 200 THEN
    RAISE EXCEPTION 'invalid_session';
  END IF;

  IF p_signed_amount IS NULL OR p_signed_amount <= 0 THEN
    RAISE EXCEPTION 'checkout_token_mismatch';
  END IF;

  SELECT o.notes, o.total, o.amount_paid, o.wallet_amount_used,
         o.shipping_status, o.payment_status
    INTO v_raw_notes, v_total, v_amount_paid, v_wallet_used,
         v_shipping_status, v_payment_status
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.merchant_id = p_merchant_id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  v_hash := pg_catalog.encode(
    extensions.digest(p_checkout_token, 'sha256'),
    'hex'
  );

  SELECT t.id, t.order_id, t.merchant_id, t.session_id, t.signed_amount,
         t.consumed_at, t.expires_at
    INTO v_token_id, v_token_order, v_token_merchant, v_token_session,
         v_token_amount, v_consumed_at, v_expires_at
  FROM public.credit_direct_checkout_tokens AS t
  WHERE t.token_hash = v_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_checkout_token';
  END IF;

  IF v_token_order IS DISTINCT FROM p_order_id
     OR v_token_merchant IS DISTINCT FROM p_merchant_id
     OR v_token_session IS DISTINCT FROM p_session_id
     OR v_token_amount IS DISTINCT FROM p_signed_amount THEN
    RAISE EXCEPTION 'checkout_token_mismatch';
  END IF;

  IF v_consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'checkout_token_already_used';
  END IF;
  IF v_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'checkout_token_expired';
  END IF;

  SELECT s.credit_direct_enabled
    INTO v_enabled
  FROM public.merchant_feature_settings AS s
  WHERE s.merchant_id = p_merchant_id
  LIMIT 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'credit_direct_disabled';
  END IF;

  IF v_shipping_status = 'cancelled' THEN
    RAISE EXCEPTION 'order_not_payable';
  END IF;
  IF v_payment_status IS NULL
     OR v_payment_status NOT IN ('unpaid', 'pending', 'partially_paid', 'bnpl_pending') THEN
    RAISE EXCEPTION 'order_not_payable';
  END IF;

  v_derived := private.credit_direct_net_payable(
    p_order_id,
    p_merchant_id,
    v_total,
    v_amount_paid,
    v_wallet_used,
    v_payment_status
  );
  IF v_derived IS NULL OR v_derived <= 0
     OR pg_catalog.abs(v_derived - v_token_amount) > 0.01 THEN
    RAISE EXCEPTION 'order_amount_changed';
  END IF;

  UPDATE public.credit_direct_checkout_tokens
  SET consumed_at = pg_catalog.now()
  WHERE id = v_token_id
    AND consumed_at IS NULL;
  GET DIAGNOSTICS v_consumed_count = ROW_COUNT;
  IF v_consumed_count <> 1 THEN
    RAISE EXCEPTION 'checkout_token_already_used';
  END IF;

  IF v_raw_notes IS NOT NULL AND pg_catalog.btrim(v_raw_notes) <> '' THEN
    BEGIN
      v_notes := v_raw_notes::jsonb;
      IF pg_catalog.jsonb_typeof(v_notes) <> 'object' THEN
        v_notes := '{}'::jsonb;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      v_notes := '{}'::jsonb;
    END;
  END IF;

  IF pg_catalog.jsonb_typeof(v_notes->'creditDirectSupersededReferences') = 'array' THEN
    v_superseded := v_notes->'creditDirectSupersededReferences';
  END IF;

  v_prev_txn := COALESCE(
    NULLIF(pg_catalog.btrim(v_notes->>'creditDirectTransactionId'), ''),
    NULLIF(pg_catalog.btrim(v_notes->>'credit_directTransactionId'), '')
  );
  v_prev_session := v_notes->>'creditDirectSessionId';
  v_completed_txn := v_notes->>'creditDirectClientCompletedTransactionId';
  v_completed_session := v_notes->>'creditDirectClientCompletedSessionId';

  IF v_prev_txn IS NOT NULL AND v_prev_txn <> ''
     AND v_prev_session IS DISTINCT FROM p_session_id
     AND NOT (v_superseded ? v_prev_txn) THEN
    v_superseded := v_superseded || pg_catalog.to_jsonb(v_prev_txn);
  END IF;

  IF v_completed_txn IS NOT NULL AND v_completed_txn <> ''
     AND COALESCE(v_completed_session, v_prev_session)
       IS DISTINCT FROM p_session_id
     AND NOT (v_superseded ? v_completed_txn) THEN
    v_superseded := v_superseded || pg_catalog.to_jsonb(v_completed_txn);
  END IF;

  IF v_prev_session IS NOT NULL AND v_prev_session <> ''
     AND v_prev_session <> p_session_id
     AND NOT (v_superseded ? v_prev_session) THEN
    v_superseded := v_superseded || pg_catalog.to_jsonb(v_prev_session);
  END IF;

  IF v_completed_session IS NOT NULL AND v_completed_session <> ''
     AND v_completed_session <> p_session_id
     AND NOT (v_superseded ? v_completed_session) THEN
    v_superseded := v_superseded || pg_catalog.to_jsonb(v_completed_session);
  END IF;

  IF pg_catalog.jsonb_array_length(v_superseded) > 8 THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
      INTO v_superseded
    FROM (
      SELECT elem, ord
      FROM pg_catalog.jsonb_array_elements(v_superseded)
        WITH ORDINALITY AS t(elem, ord)
      ORDER BY ord DESC
      LIMIT 8
    ) recent;
  END IF;

  v_notes :=
    (v_notes - 'creditDirectTransactionId' - 'credit_directTransactionId') ||
    pg_catalog.jsonb_build_object(
      'creditDirectSessionId',
      p_session_id,
      'creditDirectSignedAmount',
      v_derived,
      'creditDirectSignedAt',
      pg_catalog.to_char(
        pg_catalog.now() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'creditDirectSupersededReferences',
      v_superseded
    );

  UPDATE public.orders
  SET
    payment_method = 'credit_direct',
    payment_status = 'bnpl_pending',
    notes = v_notes::text
  WHERE id = p_order_id;

  RETURN true;
END;
$$;

ALTER FUNCTION
  public.set_credit_direct_session(text, uuid, uuid, text, numeric)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION
  public.set_credit_direct_session(text, uuid, uuid, text, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.set_credit_direct_session(text, uuid, uuid, text, numeric)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_order_tracking(
  p_merchant_slug TEXT,
  p_order_id UUID DEFAULT NULL,
  p_order_number TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_tracking_token TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  order_number TEXT,
  shipping_status TEXT,
  payment_status TEXT,
  payment_method TEXT,
  subtotal NUMERIC,
  shipping_cost NUMERIC,
  discount_amount NUMERIC,
  tax_amount NUMERIC,
  gift_wrapping_fee NUMERIC,
  total NUMERIC,
  amount_paid NUMERIC,
  wallet_amount_used NUMERIC,
  wallet_ledger_used NUMERIC,
  savings_ledger_used NUMERIC,
  wallet_reversal_completed BOOLEAN,
  wallet_reversed_credit NUMERIC,
  currency TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  shipping_address JSONB,
  tracking_number TEXT,
  shipping_provider TEXT,
  paid_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  external_source TEXT,
  import_job_id UUID,
  merchant_id UUID,
  merchant_business_name TEXT,
  merchant_slug TEXT,
  merchant_logo_url TEXT,
  merchant_support_email TEXT,
  merchant_support_phone TEXT,
  merchant_phone TEXT,
  items JSONB,
  payment_accounts JSONB,
  notification_delivered BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT;
  v_merchant_id UUID;
  v_order_id UUID;
  v_is_token_lookup BOOLEAN := FALSE;
BEGIN
  IF p_merchant_slug IS NULL OR pg_catalog.btrim(p_merchant_slug) = '' THEN
    RAISE EXCEPTION 'merchant_slug_required';
  END IF;

  SELECT m.id INTO v_merchant_id
  FROM public.merchants m
  WHERE pg_catalog.lower(m.slug) = pg_catalog.lower(pg_catalog.btrim(p_merchant_slug))
  LIMIT 1;

  IF v_merchant_id IS NULL THEN
    RETURN;
  END IF;

  IF p_tracking_token IS NOT NULL AND pg_catalog.btrim(p_tracking_token) != '' THEN
    v_is_token_lookup := TRUE;
    SELECT o.id INTO v_order_id
    FROM public.orders o
    WHERE o.merchant_id = v_merchant_id
      AND o.tracking_token = p_tracking_token
    LIMIT 1;
  ELSE
    v_email := pg_catalog.lower(pg_catalog.btrim(p_email));

    IF v_email IS NULL OR v_email = '' THEN
      RAISE EXCEPTION 'email_required';
    END IF;

    IF p_order_id IS NULL AND (p_order_number IS NULL OR pg_catalog.btrim(p_order_number) = '') THEN
      RAISE EXCEPTION 'order_id_or_number_required';
    END IF;

    SELECT o.id INTO v_order_id
    FROM public.orders o
    WHERE o.merchant_id = v_merchant_id
      AND pg_catalog.lower(o.customer_email) = v_email
      AND (
        (
          p_order_id IS NOT NULL
          AND p_order_number IS NOT NULL
          AND o.id = p_order_id
          AND o.order_number = p_order_number
        )
        OR (
          p_order_id IS NOT NULL
          AND p_order_number IS NULL
          AND o.id = p_order_id
        )
        OR (
          p_order_id IS NULL
          AND p_order_number IS NOT NULL
          AND o.order_number = p_order_number
        )
      )
    LIMIT 1;
  END IF;

  IF v_order_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.shipping_status,
    o.payment_status,
    o.payment_method,
    o.subtotal,
    o.shipping_fee AS shipping_cost,
    o.discount_amount,
    o.tax_amount,
    o.gift_wrapping_fee,
    o.total,
    o.amount_paid,
    COALESCE(o.wallet_amount_used, 0) AS wallet_amount_used,
    GREATEST(
      COALESCE(
        (
          SELECT SUM(GREATEST(t.amount, 0))
          FROM public.customer_wallet_transactions t
          WHERE t.source_id = o.id
            AND t.merchant_id = o.merchant_id
            AND t.source_type = 'order_redemption'
            AND t.type = 'redemption'
            AND t.status = 'completed'
        ),
        0
      ) - COALESCE(
        (
          SELECT SUM(GREATEST(t.amount, 0))
          FROM public.customer_wallet_transactions t
          WHERE t.source_id = o.id
            AND t.merchant_id = o.merchant_id
            AND t.source_type = 'order_reversal'
            AND t.status = 'completed'
        ),
        0
      ),
      0
    ) AS wallet_ledger_used,
    COALESCE(
      (
        SELECT SUM(GREATEST(r.amount, 0))
        FROM public.customer_savings_redemptions r
        WHERE r.order_id = o.id
          AND r.merchant_id = o.merchant_id
          AND NOT (COALESCE(r.metadata, '{}'::jsonb) ? 'reversed_at')
      ),
      0
    ) AS savings_ledger_used,
    EXISTS (
      SELECT 1
      FROM public.customer_wallet_transactions rev
      WHERE rev.source_id = o.id
        AND rev.merchant_id = o.merchant_id
        AND rev.source_type = 'order_reversal'
        AND rev.status = 'completed'
    ) AS wallet_reversal_completed,
    COALESCE(
      (
        SELECT SUM(GREATEST(rev.amount, 0))
        FROM public.customer_wallet_transactions rev
        WHERE rev.source_id = o.id
          AND rev.merchant_id = o.merchant_id
          AND rev.source_type = 'order_reversal'
          AND rev.status = 'completed'
      ),
      0
    ) AS wallet_reversed_credit,
    o.currency,
    o.created_at,
    o.updated_at,
    o.customer_name,
    CASE WHEN v_is_token_lookup THEN o.customer_email
    ELSE
      CASE WHEN o.customer_email IS NULL OR o.customer_email = '' THEN '***'
           WHEN pg_catalog.strpos(o.customer_email, '@') = 0 THEN '***'
           WHEN pg_catalog.length(pg_catalog.split_part(o.customer_email, '@', 1)) <= 2
             THEN pg_catalog.left(pg_catalog.split_part(o.customer_email, '@', 1), 1) || '***@' || pg_catalog.split_part(o.customer_email, '@', 2)
           ELSE pg_catalog.left(pg_catalog.split_part(o.customer_email, '@', 1), 2) || '***@' || pg_catalog.split_part(o.customer_email, '@', 2)
      END
    END AS customer_email,
    CASE WHEN v_is_token_lookup THEN o.customer_phone
    ELSE
      CASE WHEN o.customer_phone IS NULL OR o.customer_phone = '' THEN '***'
           WHEN pg_catalog.length(o.customer_phone) <= 6 THEN pg_catalog.repeat('*', pg_catalog.length(o.customer_phone))
           ELSE pg_catalog.left(o.customer_phone, 2) || pg_catalog.repeat('*', GREATEST(pg_catalog.length(o.customer_phone) - 4, 2)) || pg_catalog.right(o.customer_phone, 2)
      END
    END AS customer_phone,
    o.shipping_address,
    o.tracking_number,
    o.shipping_provider,
    o.paid_at,
    o.shipped_at,
    o.delivered_at,
    o.cancelled_at,
    o.external_source,
    o.import_job_id,
    m.id AS merchant_id,
    m.business_name AS merchant_business_name,
    m.slug AS merchant_slug,
    m.logo_url AS merchant_logo_url,
    m.support_email AS merchant_support_email,
    m.support_phone AS merchant_support_phone,
    m.phone AS merchant_phone,
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'image_url', oi.image_url,
            'name', oi.name,
            'condition', oi.condition,
            'variant_name', oi.variant_name,
            'quantity', oi.quantity,
            'price', oi.price,
            'product_images', p.images
          )
          ORDER BY oi.line_id NULLS LAST, oi.id
        )
        FROM public.order_items oi
        LEFT JOIN public.products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id
      ),
      '[]'::jsonb
    ) AS items,
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'account_number', opa.account_number,
            'bank_name', opa.bank_name,
            'account_name', opa.account_name,
            'provider', opa.provider,
            'assignment_customer_email_source', opa.assignment_customer_email_source,
            'created_at', opa.created_at,
            'assigned_at', opa.assigned_at,
            'expires_at', opa.expires_at
          )
          ORDER BY opa.created_at DESC NULLS LAST, opa.account_number
        )
        FROM public.order_payment_accounts opa
        WHERE opa.order_id = o.id
      ),
      '[]'::jsonb
    ) AS payment_accounts,
    EXISTS (
      SELECT 1
      FROM public.immediate_order_notification_claims c
      WHERE c.order_id = o.id
        AND c.status = 'sent'
    ) AS notification_delivered
  FROM public.orders o
  JOIN public.merchants m ON m.id = o.merchant_id
  WHERE o.id = v_order_id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT) IS
  'Retrieve order tracking info by token or email+order, including wallet_amount_used and reversal-aware wallet/savings ledger sums for guest BNPL net-payable calculations.';

-- Align paid-order amendment checkout claim with the net-payable amount so
-- savings-funded Paystack checkouts do not mismatch o.total.
CREATE OR REPLACE FUNCTION public.claim_checkout_for_paid_order_amendment(
  p_order_id uuid, p_tracking_token text, p_gateway text, p_reference text,
  p_currency text, p_expected_amount_minor bigint,
  p_platform_fee_minor bigint DEFAULT NULL, p_retained_shipping_minor bigint DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  v_merchant uuid;
  v_integration bigint;
  v_wallet_checkout boolean;
  v_net_payable numeric;
  v_expected_amount_minor bigint;
BEGIN
  SELECT merchant_id INTO v_merchant FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN 'untracked'; END IF;
  SELECT paystack_integration_id,integration_wallet_checkout INTO v_integration,v_wallet_checkout
  FROM private.paid_order_amendment_config WHERE merchant_id = v_merchant FOR SHARE;
  IF NOT FOUND THEN RETURN 'untracked'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT * INTO o FROM public.orders WHERE id = p_order_id AND merchant_id = v_merchant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_tracking_token IS NULL OR NOT COALESCE(public.verify_order_tracking_token(p_order_id, p_tracking_token), false) THEN
    RAISE EXCEPTION 'checkout_proof_required' USING ERRCODE = '42501';
  END IF;
  IF o.payment_status NOT IN ('unpaid', 'pending')
     OR o.shipping_status NOT IN ('pending', 'processing')
     OR o.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = o.id) THEN
    RAISE EXCEPTION 'amendment_payment_open';
  END IF;
  IF COALESCE(p_gateway, '') IN ('paystack_dva', 'paystack_bank_transfer') THEN
    RAISE EXCEPTION 'amendment_ineligible';
  END IF;
  IF p_gateway = 'paystack_no_subaccount' AND NOT v_wallet_checkout THEN
    RAISE EXCEPTION 'checkout_gateway_not_configured';
  END IF;
  v_net_payable := private.credit_direct_net_payable(
    o.id,
    o.merchant_id,
    o.total,
    o.amount_paid,
    o.wallet_amount_used,
    o.payment_status
  );
  v_expected_amount_minor := CASE
    WHEN COALESCE(p_gateway, '') = 'klump'
      THEN (pg_catalog.ceil(GREATEST(v_net_payable, 0))::bigint * 100)
    ELSE pg_catalog.round(v_net_payable * 100)::bigint
  END;
  IF p_expected_amount_minor IS NULL
     OR p_expected_amount_minor <> v_expected_amount_minor
     OR p_expected_amount_minor <= 0 THEN
    RAISE EXCEPTION 'amendment_ineligible';
  END IF;
  -- Non-Paystack gateways (BNPL, Korapay, Juicyway) and partial store-credit
  -- orders (wallet/savings) are ineligible for paid-order amendments; leave them
  -- untracked so ordinary checkout can initialize the net-payable amount.
  IF COALESCE(p_gateway, '') IN ('credit_direct', 'klump', 'korapay', 'juicyway')
     OR COALESCE(o.wallet_amount_used, 0) <> 0
     OR COALESCE(o.amount_paid, 0) <> 0
     OR pg_catalog.round(v_net_payable * 100)::bigint <> pg_catalog.round(o.total * 100)::bigint THEN
    RETURN 'untracked';
  END IF;
  IF v_integration IS NULL OR COALESCE(p_gateway,'') NOT IN ('paystack','paystack_no_subaccount')
     OR p_currency IS DISTINCT FROM 'NGN'
     OR p_reference IS NULL OR p_reference !~ '^BAC-[A-Z0-9]{12}$' THEN
    RAISE EXCEPTION 'amendment_ineligible';
  END IF;
  IF p_platform_fee_minor IS NOT NULL OR p_retained_shipping_minor IS NOT NULL THEN
    IF p_platform_fee_minor IS NULL OR p_platform_fee_minor NOT BETWEEN 0 AND p_expected_amount_minor
      OR p_retained_shipping_minor IS DISTINCT FROM least(
        pg_catalog.round(private.gigl_order_remaining_retained_shipping(o.id, o.merchant_id) * 100)::bigint,
        p_expected_amount_minor - p_platform_fee_minor)
    THEN RAISE EXCEPTION 'checkout_payment_details_changed'; END IF;
  END IF;
  INSERT INTO private.paid_order_checkout_claims(
    order_id, reference, gateway, currency, expected_amount_minor, order_version
  ) VALUES (o.id, p_reference, 'paystack', p_currency, p_expected_amount_minor, pg_catalog.md5(pg_catalog.to_jsonb(o)::text))
  ON CONFLICT (order_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'amendment_payment_open'; END IF;
  INSERT INTO private.paid_order_checkout_capture_bindings(
    reference, order_id, expected_amount_minor, currency, provider_integration_id, order_fingerprint, integration_wallet_checkout
  ) VALUES (p_reference, o.id, p_expected_amount_minor, p_currency, v_integration,
    private.paid_order_checkout_fingerprint(o), v_wallet_checkout);
  RETURN CASE WHEN v_wallet_checkout THEN 'claimed_integration' ELSE 'claimed' END;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_checkout_for_paid_order_amendment(uuid,text,text,text,text,bigint,bigint,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_checkout_for_paid_order_amendment(uuid,text,text,text,text,bigint,bigint,bigint)
  TO anon, authenticated;

-- Enforce authoritative net-payable upper bound inside create_payment_transaction
-- under the order-scoped advisory lock so concurrent wallet/savings redemptions
-- cannot let a stale pre-credit charge commit.
DROP FUNCTION IF EXISTS public.create_payment_transaction(
  uuid,
  uuid,
  numeric,
  text,
  text,
  text,
  numeric,
  numeric,
  text,
  text,
  text,
  jsonb
);

CREATE OR REPLACE FUNCTION public.create_payment_transaction(
  p_merchant_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_currency text,
  p_gateway text,
  p_reference text,
  p_platform_fee numeric,
  p_merchant_amount numeric,
  p_customer_email text,
  p_customer_name text,
  p_session_id text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order_merchant_id uuid;
  v_order_total numeric;
  v_order_amount_paid numeric;
  v_order_wallet_used numeric;
  v_order_current_payment_status text;
  v_order_email text;
  v_net_payable numeric;
  v_max_order_amount numeric;
  v_max_net_payable numeric;
  v_existing_id uuid;
  v_existing_order_id uuid;
  v_existing_merchant_id uuid;
  v_gateway text := lower(trim(COALESCE(p_gateway, '')));
  v_order_payment_status text;
  v_reference text := trim(COALESCE(p_reference, ''));
  v_request_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), ''),
    ''
  );
  v_request_user_id uuid := auth.uid();
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id_required';
  END IF;

  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required';
  END IF;

  IF v_reference = '' THEN
    RAISE EXCEPTION 'reference_required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT
    o.merchant_id,
    o.total,
    o.amount_paid,
    o.wallet_amount_used,
    o.payment_status,
    o.customer_email
    INTO
      v_order_merchant_id,
      v_order_total,
      v_order_amount_paid,
      v_order_wallet_used,
      v_order_current_payment_status,
      v_order_email
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_order_merchant_id IS NULL THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF v_order_merchant_id <> p_merchant_id THEN
    RAISE EXCEPTION 'merchant_mismatch';
  END IF;

  IF v_request_role <> 'service_role' THEN
    IF v_request_user_id IS NULL THEN
      RAISE EXCEPTION 'authenticated_user_required';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.merchants m
      WHERE m.id = p_merchant_id
        AND m.user_id = v_request_user_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.merchant_id = p_merchant_id
        AND sm.user_id = v_request_user_id
        AND sm.status = 'active'
    ) THEN
      RAISE EXCEPTION 'unauthorized_merchant';
    END IF;
  END IF;

  IF lower(trim(COALESCE(v_order_email, ''))) IS DISTINCT FROM
    lower(trim(COALESCE(p_customer_email, ''))) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  IF COALESCE(lower(trim(v_order_current_payment_status)), 'unpaid') IN (
       'bnpl_approved',
       'refunded',
       'cancelled',
       'canceled'
     )
     OR (
       lower(trim(COALESCE(v_order_current_payment_status, ''))) = 'paid'
       AND (
         v_gateway IN ('klump', 'credit_direct')
         OR NOT EXISTS (
           SELECT 1
           FROM private.paid_order_amendment_config cfg
           WHERE cfg.merchant_id = p_merchant_id
         )
       )
     ) THEN
    RAISE EXCEPTION 'amount_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.paid_order_amendments pa
    WHERE pa.order_id = p_order_id
  ) THEN
    RAISE EXCEPTION 'amendment_payment_open';
  END IF;

  v_max_order_amount := CASE
    WHEN v_gateway = 'klump' THEN pg_catalog.ceil(GREATEST(v_order_total, 0))
    ELSE v_order_total
  END;
  IF v_order_total IS NOT NULL AND p_amount > v_max_order_amount THEN
    RAISE EXCEPTION 'amount_exceeds_total';
  END IF;

  IF v_order_total IS NOT NULL THEN
    -- Keep lock order aligned with 20261031001000 (orders FOR UPDATE -> wallet -> savings_reversal)
    PERFORM pg_catalog.pg_advisory_xact_lock(
      ('x' || pg_catalog.substr(pg_catalog.md5(p_order_id::text), 1, 16))::bit(64)::bigint
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('savings_reversal:' || p_order_id::text, 0)
    );
    v_net_payable := private.credit_direct_net_payable(
      p_order_id,
      p_merchant_id,
      v_order_total,
      v_order_amount_paid,
      v_order_wallet_used,
      v_order_current_payment_status
    );
    IF v_net_payable <= 0 THEN
      RAISE EXCEPTION 'amount_invalid';
    END IF;
    v_max_net_payable := CASE
      WHEN v_gateway = 'klump' THEN pg_catalog.ceil(GREATEST(v_net_payable, 0))
      ELSE v_net_payable
    END;
    IF p_amount > v_max_net_payable THEN
      RAISE EXCEPTION 'amount_exceeds_total';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.order_id = p_order_id
      AND t.merchant_id = p_merchant_id
      AND t.gateway_reference = v_reference
  ) AND (
    lower(trim(COALESCE(v_order_current_payment_status, ''))) = 'bnpl_pending'
    OR EXISTS (
      SELECT 1
      FROM public.transactions t
      WHERE t.order_id = p_order_id
        AND t.transaction_type = 'payment'
        AND t.gateway IN ('klump', 'credit_direct')
        AND t.status IN ('pending', 'processing')
        AND t.gateway_reference IS DISTINCT FROM v_reference
    )
  ) THEN
    RAISE EXCEPTION 'amount_invalid';
  END IF;

  v_order_payment_status := CASE
    WHEN v_gateway IN ('klump', 'credit_direct') THEN 'bnpl_pending'
    ELSE 'pending'
  END;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_reference, 0));

  SELECT t.id, t.order_id, t.merchant_id
    INTO v_existing_id, v_existing_order_id, v_existing_merchant_id
  FROM public.transactions t
  WHERE t.gateway_reference = v_reference
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_order_id IS DISTINCT FROM p_order_id
      OR v_existing_merchant_id IS DISTINCT FROM p_merchant_id THEN
      RAISE EXCEPTION 'reference_in_use';
    END IF;

    UPDATE public.orders o
    SET
      payment_status = v_order_payment_status,
      currency = COALESCE(p_currency, o.currency),
      updated_at = now()
    WHERE o.id = p_order_id
      AND o.merchant_id = p_merchant_id
      AND o.payment_status NOT IN (
        'paid',
        'partially_paid',
        'bnpl_approved',
        'refunded',
        'cancelled'
      );

    RETURN v_existing_id;
  END IF;

  INSERT INTO public.transactions (
    merchant_id,
    order_id,
    transaction_type,
    amount,
    currency,
    status,
    gateway,
    gateway_reference,
    platform_fee,
    merchant_amount,
    description,
    metadata
  ) VALUES (
    p_merchant_id,
    p_order_id,
    'payment',
    p_amount,
    COALESCE(p_currency, 'NGN'),
    'pending',
    v_gateway,
    v_reference,
    p_platform_fee,
    p_merchant_amount,
    'Payment for order ' || p_order_id::text,
    jsonb_strip_nulls(
      jsonb_build_object(
        'customer_email', p_customer_email,
        'customer_name', p_customer_name,
        'session_id', p_session_id
      ) || COALESCE(p_metadata, '{}'::jsonb)
    )
  )
  RETURNING transactions.id INTO v_existing_id;

  UPDATE public.orders o
  SET
    payment_status = v_order_payment_status,
    currency = COALESCE(p_currency, o.currency),
    updated_at = now()
  WHERE o.id = p_order_id
    AND o.merchant_id = p_merchant_id
    AND o.payment_status NOT IN (
      'paid',
      'partially_paid',
      'bnpl_approved',
      'refunded',
      'cancelled'
    );

  RETURN v_existing_id;
END;
$$;

COMMENT ON FUNCTION public.create_payment_transaction(
  uuid,
  uuid,
  numeric,
  text,
  text,
  text,
  numeric,
  numeric,
  text,
  text,
  text,
  jsonb
) IS
  'Creates an authorized pending payment transaction with metadata, enforcing net-payable bounds under the order lock and moving BNPL gateways into bnpl_pending.';

REVOKE ALL ON FUNCTION public.create_payment_transaction(
  uuid,
  uuid,
  numeric,
  text,
  text,
  text,
  numeric,
  numeric,
  text,
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_transaction(
  uuid,
  uuid,
  numeric,
  text,
  text,
  text,
  numeric,
  numeric,
  text,
  text,
  text,
  jsonb
) TO authenticated, service_role;
