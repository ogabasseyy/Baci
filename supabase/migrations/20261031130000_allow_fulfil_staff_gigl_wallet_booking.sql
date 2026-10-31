-- Owner decision (2026-10-31): staff whose merged permissions grant
-- orders.fulfill may run the admin GIG merchant-wallet flow the owner runs.
-- Staff without orders.fulfill stay blocked; the owner keeps full access
-- because the helper short-circuits for the merchant owner.
--
-- Read and consent steps need orders.fulfill: price preview and bound-quote
-- reuse (one balance number), the wallet funding account view, funding
-- consent and funding recovery. Write steps that commit the order to a
-- booking need orders.fulfill AND orders.edit: quote binding, a NEW wallet
-- debit, and customer-checkout shipping recovery. Booking itself
-- (claim_order_shipment_booking and the final order write) runs under
-- orders_update_policy (owner or orders.edit), so a fulfil-only debit or
-- destination change could never be consumed by a booking. Requiring both
-- keeps the chain consistent; it changes nothing for the owner or for staff
-- roles that hold both grants.
--
-- Every gate calls the SECURITY DEFINER helper public.check_staff_permission
-- with the caller's own auth.uid(). No policy inlines a merchants <->
-- staff_members subquery (42P17 recursion). get_wallet_summary is NOT
-- widened: it also returns earnings, withdrawals, settlements and payout
-- schedule. Copied bodies come verbatim from their newest definitions; only
-- the authorization lines differ.

-- 0. Actor attribution. Staff can now spend wallet money and give funding
--    consent, so record who acted. The columns are added without a default
--    first so existing rows stay NULL; new rows capture the caller's JWT
--    subject, including inside the SECURITY DEFINER reservation, whose INSERT
--    does not list the column. Clients cannot forge either value:
--    authenticated has no write grant on merchant_shipping_charges, and the
--    funding-request insert policy below pins requested_by to the caller.
ALTER TABLE public.merchant_shipping_charges ADD COLUMN reserved_by uuid;
ALTER TABLE public.merchant_shipping_charges
  ALTER COLUMN reserved_by SET DEFAULT auth.uid();
COMMENT ON COLUMN public.merchant_shipping_charges.reserved_by IS
  'auth.users id of the owner or staff member who created the wallet debit; NULL for rows created before 2026-10-31.';
GRANT SELECT (reserved_by) ON TABLE public.merchant_shipping_charges TO authenticated;
ALTER TABLE public.merchant_wallet_funding_account_requests
  ADD COLUMN requested_by uuid;
ALTER TABLE public.merchant_wallet_funding_account_requests
  ALTER COLUMN requested_by SET DEFAULT auth.uid();
COMMENT ON COLUMN public.merchant_wallet_funding_account_requests.requested_by IS
  'auth.users id of the owner or staff member who gave the funding-account consent; NULL for rows created before 2026-10-31.';

-- 1. Narrow balance read for the GIG preview, bound-quote reuse, the mobile
--    wallet poll and the insufficient-balance details. One number only.
CREATE OR REPLACE FUNCTION public.get_merchant_shipping_wallet_balance(
  p_merchant_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;
  IF (SELECT auth.uid()) IS NULL OR NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
  ) THEN
    RAISE EXCEPTION 'merchant_shipping_wallet_balance_forbidden'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(
    (
      SELECT wallet.available_balance
      FROM public.merchant_wallets AS wallet
      WHERE wallet.merchant_id = p_merchant_id
    ),
    0
  );
END;
$$;

ALTER FUNCTION public.get_merchant_shipping_wallet_balance(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_merchant_shipping_wallet_balance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_shipping_wallet_balance(uuid)
  TO authenticated;

-- 2. Safe funding-account projection. The table policy stays owner-only so
--    staff never read provider_account_id, provider_customer_code or metadata.
CREATE OR REPLACE FUNCTION public.get_merchant_wallet_funding_account(
  p_merchant_id uuid
)
RETURNS TABLE (
  account_name text,
  account_number text,
  bank_name text,
  currency text,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;
  IF (SELECT auth.uid()) IS NULL OR NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
  ) THEN
    RAISE EXCEPTION 'merchant_wallet_funding_account_forbidden'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    account.account_name,
    account.account_number,
    account.bank_name,
    account.currency,
    account.status
  FROM public.merchant_wallet_payment_accounts AS account
  WHERE account.merchant_id = p_merchant_id
    AND account.status IN ('active', 'pending')
  ORDER BY account.created_at, account.id;
END;
$$;

ALTER FUNCTION public.get_merchant_wallet_funding_account(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_merchant_wallet_funding_account(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_wallet_funding_account(uuid)
  TO authenticated;

-- 3. Bind rewrites the order's address, provider and funding source, so the
--    owner-only check becomes orders.fulfill AND orders.edit.
CREATE OR REPLACE FUNCTION public.bind_admin_gigl_quote(
  p_order_id uuid,
  p_merchant_id uuid,
  p_quote_id uuid,
  p_receiver jsonb
)
RETURNS TABLE (quote jsonb, available_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote public.shipping_quotes%ROWTYPE;
  v_attestation public.shipping_quote_attestations%ROWTYPE;
  v_balance numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
    )
    AND public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'orders', 'edit'
    )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND merchant_id = p_merchant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.shipping_funding_source = 'customer_checkout'
     AND private.order_settled_gigl_retained_amount(p_order_id, p_merchant_id) > 0 THEN
    RAISE EXCEPTION 'customer_checkout_wallet_rebind_forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL
     OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'order_already_shipped_or_booked';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'order_already_shipped_or_booked';
  END IF;
  SELECT * INTO v_quote FROM public.shipping_quotes WHERE id = p_quote_id FOR UPDATE;
  SELECT * INTO v_attestation
  FROM public.shipping_quote_attestations
  WHERE quote_id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_quote.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_quote.session_id IS DISTINCT FROM p_order_id::text
     OR v_quote.provider IS DISTINCT FROM 'GIGL'
     OR v_quote.currency IS DISTINCT FROM 'NGN'
     OR v_quote.is_station_pickup
     OR v_quote.expires_at <= now()
     OR v_quote.price <= 0
     OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
     OR v_attestation.order_id IS DISTINCT FROM p_order_id
     OR v_attestation.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id
     OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request
     OR v_attestation.price IS DISTINCT FROM v_quote.price
     OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_attestation.currency IS DISTINCT FROM v_quote.currency
     OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at
     OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup
     OR v_attestation.quote_request->'receiver' IS DISTINCT FROM p_receiver THEN
    RAISE EXCEPTION 'invalid_quote_attestation';
  END IF;
  SELECT COALESCE(w.available_balance, 0)
  INTO v_balance
  FROM public.merchant_wallets w
  WHERE w.merchant_id = p_merchant_id
  FOR UPDATE;
  -- Reject concurrent address/item edits that diverged from the attested quote
  -- before overwriting the order with the earlier receiver snapshot. Coordinates
  -- are normalized so string vs numeric pin edits still collide.
  IF jsonb_strip_nulls(
       jsonb_build_object(
         'address', COALESCE(NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'address'), ''), ''),
         'city', NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'city'), ''),
         'latitude', CASE
           WHEN NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'latitude'), '') IS NULL THEN NULL
           WHEN btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'latitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
             AND (btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'latitude'))::numeric BETWEEN -90 AND 90
           THEN to_jsonb(round((btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'latitude'))::numeric, 6))
           ELSE to_jsonb(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'latitude'))
         END,
         'longitude', CASE
           WHEN NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'longitude'), '') IS NULL THEN NULL
           WHEN btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'longitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
             AND (btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'longitude'))::numeric BETWEEN -180 AND 180
           THEN to_jsonb(round((btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'longitude'))::numeric, 6))
           ELSE to_jsonb(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'longitude'))
         END,
         'name', NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'name'), ''),
         'phone', COALESCE(NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'phone'), ''), ''),
         'state', NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'state'), '')
       )
     ) IS DISTINCT FROM jsonb_strip_nulls(
       jsonb_build_object(
         'address', COALESCE(NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'address'), ''), ''),
         'city', NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'city'), ''),
         'latitude', CASE
           WHEN NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'latitude'), '') IS NULL THEN NULL
           WHEN btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'latitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
             AND (btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'latitude'))::numeric BETWEEN -90 AND 90
           THEN to_jsonb(round((btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'latitude'))::numeric, 6))
           ELSE to_jsonb(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'latitude'))
         END,
         'longitude', CASE
           WHEN NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'longitude'), '') IS NULL THEN NULL
           WHEN btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'longitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
             AND (btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'longitude'))::numeric BETWEEN -180 AND 180
           THEN to_jsonb(round((btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'longitude'))::numeric, 6))
           ELSE to_jsonb(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'longitude'))
         END,
         'name', NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'name'), ''),
         'phone', COALESCE(NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'phone'), ''), ''),
         'state', NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'state'), '')
       )
     ) THEN
    RAISE EXCEPTION 'stale_order_quote_inputs' USING ERRCODE = 'P0001';
  END IF;

  IF (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', btrim(oi.name),
          'quantity', oi.quantity,
          'price', oi.price
        )
        ORDER BY btrim(oi.name), oi.price, oi.quantity
      ),
      '[]'::jsonb
    )
    FROM public.order_items AS oi
    WHERE oi.order_id = p_order_id
  ) IS DISTINCT FROM (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', btrim(COALESCE(item ->> 'name', '')),
          'quantity', COALESCE(NULLIF(item ->> 'quantity', '')::integer, 0),
          'price', COALESCE(
            NULLIF(item ->> 'value', '')::numeric,
            NULLIF(item ->> 'price', '')::numeric,
            0::numeric
          )
        )
        ORDER BY btrim(COALESCE(item ->> 'name', '')),
          COALESCE(
            NULLIF(item ->> 'value', '')::numeric,
            NULLIF(item ->> 'price', '')::numeric,
            0::numeric
          ),
          COALESCE(NULLIF(item ->> 'quantity', '')::integer, 0)
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(COALESCE(v_attestation.quote_request -> 'items', '[]'::jsonb)) = 'array'
          THEN COALESCE(v_attestation.quote_request -> 'items', '[]'::jsonb)
        ELSE '[]'::jsonb
      END
    ) AS item
  ) THEN
    RAISE EXCEPTION 'stale_order_quote_inputs' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders
  SET selected_quote_id = p_quote_id,
      shipping_provider = 'GIGL',
      shipping_address = p_receiver,
      shipping_funding_source = 'merchant_wallet'
  WHERE id = p_order_id;
  RETURN QUERY SELECT jsonb_build_object(
    'id', v_quote.id,
    'merchant_id', v_quote.merchant_id,
    'session_id', v_quote.session_id,
    'provider', v_quote.provider,
    'service_tier', v_quote.service_tier,
    'carrier_name', v_quote.carrier_name,
    'price', v_quote.price,
    'currency', v_quote.currency,
    'estimated_days', v_quote.estimated_days,
    'min_days', v_quote.min_days,
    'max_days', v_quote.max_days,
    'pickup_included', v_quote.pickup_included,
    'insurance_included', v_quote.insurance_included,
    'provider_rate_id', v_quote.provider_rate_id,
    'is_station_pickup', v_quote.is_station_pickup,
    'station_name', v_quote.station_name,
    'station_address', v_quote.station_address,
    'quote_request', v_quote.quote_request,
    'used', v_quote.used,
    'expires_at', v_quote.expires_at,
    'created_at', v_quote.created_at
  ), v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)
  TO authenticated;

-- 4. Reserve: new wallet debits admit the owner or staff granted both
--    orders.fulfill and orders.edit.
CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge(
  p_order_id uuid,
  p_quote_id uuid,
  p_attempt_token text
)
RETURNS TABLE(charge_id uuid, charged_amount numeric, balance_after numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote public.shipping_quotes%ROWTYPE;
  v_attestation public.shipping_quote_attestations%ROWTYPE;
  v_wallet public.merchant_wallets%ROWTYPE;
  v_existing public.merchant_shipping_charges%ROWTYPE;
  v_tx uuid;
  v_charge_id uuid;
  v_charge_status text;
  v_is_owner boolean := false;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id, 0)
  );
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  v_is_owner := EXISTS (
    SELECT 1
    FROM public.merchants AS merchant
    WHERE merchant.id = v_order.merchant_id
      AND merchant.user_id = (SELECT auth.uid())
  );
  IF NOT FOUND
     OR NOT (
       v_is_owner
       OR public.check_staff_permission(
         (SELECT auth.uid()), v_order.merchant_id, 'orders', 'fulfill'
       )
       OR public.check_staff_permission(
         (SELECT auth.uid()), v_order.merchant_id, 'orders', 'edit'
       )
     )
     OR v_order.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'
     OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing'
     OR v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'order_not_owned' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.merchant_shipping_charges
  WHERE order_id = p_order_id AND shipping_quote_id = p_quote_id
  FOR UPDATE;
  SELECT * INTO v_quote
  FROM public.shipping_quotes
  WHERE id = p_quote_id
    AND merchant_id = v_order.merchant_id
    AND provider = 'GIGL'
    AND currency = 'NGN'
  FOR SHARE;
  SELECT * INTO v_attestation
  FROM public.shipping_quote_attestations
  WHERE quote_id = p_quote_id
  FOR SHARE;
  IF v_quote.id IS NULL OR v_attestation.quote_id IS NULL
     OR v_order.selected_quote_id IS DISTINCT FROM p_quote_id
     OR v_order.shipping_provider IS DISTINCT FROM 'GIGL'
     OR v_order.shipping_provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_order.shipping_platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_order.shipping_pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_quote.session_id IS DISTINCT FROM p_order_id::text
     OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
     OR v_quote.is_station_pickup
     OR (v_existing.id IS NULL AND v_quote.expires_at <= now())
     OR v_attestation.order_id IS DISTINCT FROM p_order_id
     OR v_attestation.merchant_id IS DISTINCT FROM v_order.merchant_id
     OR v_attestation.price IS DISTINCT FROM v_quote.price
     OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_attestation.currency IS DISTINCT FROM v_quote.currency
     OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at
     OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup
     OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id
     OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request THEN
    RAISE EXCEPTION 'quote_not_eligible' USING ERRCODE = '22023';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'reserved' THEN
      UPDATE public.merchant_shipping_charges
      SET attempt_token_digest = pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex'),
          updated_at = now()
      WHERE id = v_existing.id;
    ELSIF v_existing.status = 'provider_submitting'
      AND v_existing.provider_submitting_at IS NOT NULL
      AND v_existing.provider_submitting_at <= now() - interval '15 minutes' THEN
      UPDATE public.merchant_shipping_charges
      SET status = 'needs_reconciliation',
          failure_code = 'STALE_PROVIDER_SUBMISSION',
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING status INTO v_charge_status;
      v_existing.status := v_charge_status;
    END IF;
    SELECT available_balance INTO balance_after
    FROM public.merchant_wallets
    WHERE merchant_id = v_order.merchant_id;
    RETURN QUERY SELECT v_existing.id, v_existing.charged_amount, balance_after, v_existing.status;
    RETURN;
  END IF;

  -- New wallet debits move merchant funds: the owner, or staff granted both
  -- orders.fulfill and orders.edit (the booking claim that consumes the debit
  -- needs orders.edit). Staff holding only one of the two may resume an
  -- existing charge above but cannot create a new debit.
  IF NOT (
    v_is_owner
    OR (
      public.check_staff_permission(
        (SELECT auth.uid()), v_order.merchant_id, 'orders', 'fulfill'
      )
      AND public.check_staff_permission(
        (SELECT auth.uid()), v_order.merchant_id, 'orders', 'edit'
      )
    )
  ) THEN
    RAISE EXCEPTION 'wallet_reservation_fulfill_edit_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_wallet
  FROM public.merchant_wallets
  WHERE merchant_id = v_order.merchant_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.available_balance, 0) < v_quote.price THEN
    RAISE EXCEPTION 'MERCHANT_WALLET_INSUFFICIENT' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.merchant_wallets
  SET available_balance = available_balance - v_quote.price, updated_at = now()
  WHERE id = v_wallet.id
  RETURNING available_balance INTO balance_after;
  INSERT INTO public.wallet_transactions(
    wallet_id, merchant_id, type, amount, balance_after, source_type, source_id,
    description, status
  ) VALUES (
    v_wallet.id, v_order.merchant_id, 'debit', v_quote.price, balance_after,
    'gigl_shipping', p_order_id, 'GIGL shipping reservation', 'completed'
  ) RETURNING id INTO v_tx;
  INSERT INTO public.merchant_shipping_charges AS charge(
    merchant_id, order_id, shipping_quote_id, currency, charged_amount,
    provider_cost, platform_margin, attempt_token_digest, debit_transaction_id
  ) VALUES (
    v_order.merchant_id, p_order_id, p_quote_id, v_quote.currency, v_quote.price,
    v_quote.provider_cost, v_quote.platform_margin,
    pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex'), v_tx
  ) RETURNING charge.id, charge.status INTO v_charge_id, v_charge_status;
  RETURN QUERY SELECT v_charge_id, v_quote.price, balance_after, v_charge_status;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text)
  TO authenticated;

-- 5. Funding requests: fulfil staff may read and create the merchant's
--    pending request. Inserts stay pending-only and must record the caller
--    as requested_by; provider assignment stays service-role or
--    HMAC-recovery only.
DROP POLICY merchant_wallet_request_owner
  ON public.merchant_wallet_funding_account_requests;
CREATE POLICY merchant_wallet_request_fulfill_read
  ON public.merchant_wallet_funding_account_requests
  FOR SELECT TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'orders', 'fulfill'
    )
  );
DROP POLICY merchant_wallet_request_owner_insert
  ON public.merchant_wallet_funding_account_requests;
CREATE POLICY merchant_wallet_request_fulfill_insert
  ON public.merchant_wallet_funding_account_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND requested_by = (SELECT auth.uid())
    AND public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'orders', 'fulfill'
    )
  );

-- 6. Failing a stuck funding request follows the same fulfil gate.
CREATE OR REPLACE FUNCTION public.fail_merchant_wallet_funding_request(p_request_id uuid,p_merchant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.check_staff_permission((SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill') THEN RAISE EXCEPTION 'merchant_fulfill_required' USING ERRCODE='42501'; END IF;
  UPDATE public.merchant_wallet_funding_account_requests SET status='failed' WHERE id=p_request_id AND merchant_id=p_merchant_id AND status='pending';
END; $$;
REVOKE ALL ON FUNCTION public.fail_merchant_wallet_funding_request(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_merchant_wallet_funding_request(uuid, uuid)
  TO authenticated;

-- 7. HMAC-attested funding-account recovery follows the same fulfil gate.
CREATE OR REPLACE FUNCTION public.complete_merchant_wallet_funding_recovery(
  p_request_id uuid,
  p_merchant_id uuid,
  p_account_number text,
  p_account_name text,
  p_bank_name text,
  p_currency text,
  p_provider_account_id text,
  p_provider_customer_code text,
  p_attested_at timestamptz,
  p_attested_at_iso text,
  p_attestation text
)
RETURNS public.merchant_wallet_payment_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_payload text;
  v_expected text;
  v_iso_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_iso_at := p_attested_at_iso::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'attestation_expired' USING ERRCODE = '22023';
  END;

  IF p_attested_at IS NULL
     OR v_iso_at IS NULL
     OR abs(extract(epoch FROM (p_attested_at - v_iso_at))) > 1
     OR p_attested_at < now() - interval '5 minutes'
     OR p_attested_at > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'attestation_expired' USING ERRCODE = '22023';
  END IF;

  SELECT secret
  INTO v_secret
  FROM private.merchant_wallet_funding_recovery_secrets
  WHERE name = 'funding_recovery_v1';
  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'recovery_secret_unprovisioned' USING ERRCODE = 'P0001';
  END IF;

  v_payload := concat_ws(
    '|',
    p_request_id::text,
    p_merchant_id::text,
    coalesce(p_account_number, ''),
    coalesce(p_account_name, ''),
    coalesce(p_bank_name, ''),
    coalesce(p_currency, ''),
    coalesce(p_provider_account_id, ''),
    coalesce(p_provider_customer_code, ''),
    coalesce(p_attested_at_iso, '')
  );
  v_expected := encode(extensions.hmac(v_payload, v_secret, 'sha256'), 'hex');
  IF lower(coalesce(p_attestation, '')) IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'invalid_attestation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('baci.wallet_funding_recovery', '1', true);
  RETURN public.persist_merchant_wallet_payment_account(
    p_request_id,
    p_merchant_id,
    p_account_number,
    p_account_name,
    p_bank_name,
    p_currency,
    p_provider_account_id,
    p_provider_customer_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_merchant_wallet_funding_recovery(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text, text
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_merchant_wallet_funding_recovery(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text, text
)
  TO authenticated;

-- 8. Customer-checkout recovery assertion (shared by prepare, context and
--    confirm). Recovery rewrites a paid order's destination and quote, so
--    staff need orders.fulfill AND orders.edit at both the pre-lock and
--    post-lock checks.
CREATE OR REPLACE FUNCTION private.assert_customer_checkout_shipping_recovery(p_order_id uuid)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE; v_enabled boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id=p_order_id
      AND public.check_staff_permission(auth.uid(),o.merchant_id,'orders','fulfill')
      AND public.check_staff_permission(auth.uid(),o.merchant_id,'orders','edit')) THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  -- Same order-payment serialization boundary as refunds and pre-submit checks.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text,0));
  -- Hold the activation row through the transaction: disabling waits for
  -- in-flight recovery writes, and new writers fail closed after it commits.
  SELECT enabled INTO v_enabled
    FROM private.checkout_shipping_recovery_release_activation
    WHERE singleton IS TRUE FOR SHARE;
  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'shipping_recovery_not_activated' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.merchants WHERE id=v_order.merchant_id FOR SHARE;
  -- Hold the caller's staff row too, so revoking access waits for this write.
  PERFORM 1 FROM public.staff_members WHERE merchant_id=v_order.merchant_id
    AND user_id=auth.uid() FOR SHARE;
  IF NOT (public.check_staff_permission(auth.uid(),v_order.merchant_id,'orders','fulfill')
    AND public.check_staff_permission(auth.uid(),v_order.merchant_id,'orders','edit')) THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  -- Freeze mutable quote inputs until this RPC ends. The parent FOR UPDATE
  -- lock also conflicts with FK checks for newly inserted order items.
  PERFORM 1 FROM public.order_items WHERE order_id=p_order_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.products p JOIN public.order_items i ON i.product_id=p.id
    WHERE i.order_id=p_order_id ORDER BY p.id FOR SHARE OF p;
  PERFORM 1 FROM public.shipping_quotes WHERE id=v_order.selected_quote_id FOR SHARE;
  PERFORM 1 FROM public.merchant_settlements WHERE source_type='order'
    AND source_id=p_order_id AND merchant_id=v_order.merchant_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.transactions WHERE order_id=p_order_id
    AND merchant_id=v_order.merchant_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.customer_wallet_transactions WHERE source_type='order_redemption'
    AND source_id=p_order_id AND merchant_id=v_order.merchant_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.customer_savings_redemptions WHERE order_id=p_order_id
    AND merchant_id=v_order.merchant_id ORDER BY id FOR SHARE;
  PERFORM public.assert_shippable_order_payment(p_order_id,v_order.merchant_id);
  IF (v_order.delivery_method IS NOT NULL AND v_order.delivery_method <> 'door')
    OR EXISTS (SELECT 1 FROM public.shipping_quotes q WHERE q.id=v_order.selected_quote_id
      AND q.merchant_id=v_order.merchant_id AND q.is_station_pickup IS TRUE)
    OR v_order.shipping_provider IS DISTINCT FROM 'GIGL'
    OR v_order.shipping_funding_source IS DISTINCT FROM 'customer_checkout'
    OR lower(COALESCE(v_order.payment_status,'')) IS DISTINCT FROM 'paid'
    OR lower(COALESCE(v_order.shipping_status,'')) IS DISTINCT FROM 'processing'
    OR lower(COALESCE(v_order.payment_method,'')) IN ('pod','pay_on_delivery','credit_direct','credit-direct','manual','manual_payment','cash')
    OR v_order.cancelled_at IS NOT NULL OR v_order.shipment_id IS NOT NULL
    OR v_order.tracking_number IS NOT NULL OR v_order.shipment_booking_lock_token IS NOT NULL
    OR COALESCE(v_order.shipping_fee,0)<=0
    OR COALESCE(v_order.shipping_platform_retained_amount,0)<v_order.shipping_fee
    OR private.uba_redvault_partial_refund_blocks_booking(p_order_id) THEN
    RAISE EXCEPTION 'shipping_recovery_unavailable' USING ERRCODE='22023';
  END IF;
  -- Use the existing settled/internal-credit retention boundary. Its positive
  -- marker also ensures the economics stamp trigger preserves paid snapshots.
  IF private.order_settled_gigl_retained_amount(p_order_id,v_order.merchant_id)<=0 THEN
    RAISE EXCEPTION 'shipping_recovery_funding_not_ready' USING ERRCODE='22023';
  END IF;
  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_customer_checkout_shipping_recovery(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- 9. Recovery confirmation, including the committed-retry branch that
--    returns before the shared assertion: the same orders.fulfill AND
--    orders.edit checks.
CREATE OR REPLACE FUNCTION public.confirm_customer_checkout_shipping_recovery(
  p_order_id uuid, p_preview_id uuid, p_confirm_destination boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE;
  v_preview private.customer_checkout_shipping_recovery_previews%ROWTYPE; v_quote_id uuid;
  v_existing jsonb; v_receiver jsonb;
BEGIN
  IF p_confirm_destination IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'destination_confirmation_required' USING ERRCODE='22023';
  END IF;
  -- A committed result remains valid after booking, refund or cancellation.
  -- Authorize and serialize independently of first-confirmation eligibility.
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id=p_order_id
      AND public.check_staff_permission(auth.uid(),o.merchant_id,'orders','fulfill')
      AND public.check_staff_permission(auth.uid(),o.merchant_id,'orders','edit')) THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text,0));
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.merchants WHERE id=v_order.merchant_id FOR SHARE;
  -- Hold the caller's staff row too, so revoking access waits for this write.
  PERFORM 1 FROM public.staff_members WHERE merchant_id=v_order.merchant_id
    AND user_id=auth.uid() FOR SHARE;
  IF NOT (public.check_staff_permission(auth.uid(),v_order.merchant_id,'orders','fulfill')
    AND public.check_staff_permission(auth.uid(),v_order.merchant_id,'orders','edit')) THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  -- Lock the order before its preview consistently with prepare/refund/booking.
  SELECT * INTO v_preview FROM private.customer_checkout_shipping_recovery_previews
    WHERE id=p_preview_id AND order_id=p_order_id AND merchant_id=v_order.merchant_id
      AND actor_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  IF v_preview.confirmed_at IS NOT NULL THEN
    -- The live quote link survives audit redaction; the quoted-receiver
    -- comparison below does not (redacted quotes lose quote_request). A
    -- selected_quote_id pointing at this preview proves this confirmation
    -- already committed, so the retry stays idempotent past redaction.
    IF v_order.selected_quote_id=v_preview.id THEN
      RETURN pg_catalog.jsonb_build_object('quoteId',v_preview.id,'confirmed',true);
    END IF;
    RAISE EXCEPTION 'shipping_recovery_stale' USING ERRCODE='40001';
  END IF;
  -- New confirmations still require every current eligibility, payment,
  -- delivery, refund and input-lock guard. Reentrant locks retain the same
  -- order-payment boundary; the idempotent branch above never writes state.
  v_order := private.assert_customer_checkout_shipping_recovery(p_order_id);
  IF v_preview.expires_at<=now() THEN
    RAISE EXCEPTION 'shipping_recovery_expired' USING ERRCODE='22023';
  END IF;
  IF v_preview.fingerprint IS DISTINCT FROM private.customer_checkout_shipping_recovery_fingerprint(p_order_id) THEN
    RAISE EXCEPTION 'shipping_recovery_stale' USING ERRCODE='40001';
  END IF;
  IF (v_preview.quote->>'price')::numeric IS DISTINCT FROM v_order.shipping_fee THEN
    RAISE EXCEPTION 'shipping_recovery_price_changed' USING ERRCODE='22023';
  END IF;
  -- Explicit operator confirmation, never inferred from legacy quote coordinates.
  -- A scalar legacy address (stored JSON string) would merge into an array
  -- with `jsonb ||`; coerce non-objects to {} so confirmation always writes
  -- a bookable address object.
  v_existing := COALESCE(v_order.shipping_address,'{}'::jsonb);
  IF pg_catalog.jsonb_typeof(v_existing) IS DISTINCT FROM 'object' THEN
    v_existing := '{}'::jsonb;
  END IF;
  -- Replace both canonical and legacy spellings from the same signed
  -- receiver. The confirmed street is complete; an old second line must
  -- not survive as a different unit in receipts. Never retain an old
  -- postcode when the replacement quote does not carry one.
  v_existing := v_existing - 'address_line1' - 'address_line2' - 'postal_code' - 'postalCode';
  v_receiver := v_preview.quote->'quote_request'->'receiver';
  UPDATE public.orders SET shipping_address=v_existing || v_receiver
      || pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'address_line1',v_receiver->'address',
        'postal_code',v_receiver->'postalCode')), updated_at=now()
    WHERE id=p_order_id AND merchant_id=v_order.merchant_id;
  -- Reuse the existing validated GIGL writer, which retains paid checkout economics.
  -- The private preview was already proof-verified and is inaccessible to clients.
  v_quote_id := public.persist_refreshed_order_shipping_quote(p_order_id,v_preview.quote);
  UPDATE private.customer_checkout_shipping_recovery_previews SET confirmed_at=now()
    WHERE id=p_preview_id;
  -- Private preview stores actor, original destination, replacement and confirmation time as audit.
  RETURN pg_catalog.jsonb_build_object('quoteId',v_quote_id,'confirmed',true);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_customer_checkout_shipping_recovery(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_customer_checkout_shipping_recovery(uuid, uuid, boolean)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
