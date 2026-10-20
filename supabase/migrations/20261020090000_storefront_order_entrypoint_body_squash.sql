-- Append-only: pin the effective storefront order entrypoint bodies.
--
-- The order entrypoints evolved through pg_get_functiondef string-patch
-- migrations plus one wholesale replacement. This forward migration
-- installs the exact effective bodies via CREATE OR REPLACE, so the
-- pair contract is reviewable in one place and future changes diff
-- against pinned bodies instead of extending the patch chain.
--
-- Lineage of the pinned unchecked body (applied in version order):
-- 20261015130500 wholesale-replaces the function (this discards the
--   08300000-09330000 M18-era patches in chronological replay);
-- 20261015140000 adds the serialized-claim ORDER BY;
-- 20261015175000 removes the nonexistent variant lifecycle predicate;
-- 20261019090000 ports the final offer state (blocks 1-10: temp
--   staging, item key, insert list, staging select, offer join,
--   invalid_offer validation, unguarded offer decrement, item insert
--   columns, live condition bind, identity select columns).
-- The checked body is an untouched delegating wrapper since 20260828.
--
-- Provenance: both bodies start from captured pg_get_functiondef
-- output; the capture source predates 19090000, so that migration's
-- port is applied here with identical anchors (each verified to hit
-- exactly once) to reproduce the replayed definition.
--
-- Semantically a no-op on a converged database: the installed bodies
-- equal the replayed definitions. Equivalence is enforced by (1) the
-- pre/post-image guard below, which fails this migration loudly when the
-- live definitions differ from the pinned bytes, and (2) the order
-- sql-check suites (both-entrypoints, entrypoints behavior, line
-- identity) which run over the final state. NOTE: the chronological
-- replay effect digest does NOT cover these two functions (its
-- function_names scope lists neither), so the digest is not part of
-- this pin's enforcement; the guard + suites are.
--
-- Historical patch files are untouched (migrations are append-only):
-- they still run with their convergence and sibling-delegation guards
-- intact. CREATE OR REPLACE preserves existing ownership and grants.
-- The guard also fails closed when either function is absent, so a
-- divergent database can never silently CREATE one fresh with default
-- PUBLIC EXECUTE (the chain revokes these entrypoints from PUBLIC).
-- Both guards also pin the 20260828 owner/grant shape (postgres owner;
-- EXECUTE for anon/authenticated/service_role on the checked wrapper,
-- owner-only on unchecked, no PUBLIC grant on either), because
-- pg_get_functiondef omits owner and ACL while CREATE OR REPLACE
-- preserves them.

DO $squash_guard$
DECLARE
  v_checked_oid oid;
  v_checked_owner oid;
  v_checked_def text;
  v_unchecked_oid oid;
  v_unchecked_owner oid;
  v_unchecked_def text;
BEGIN
  SELECT p.oid, p.proowner, pg_catalog.pg_get_functiondef(p.oid)
    INTO v_checked_oid, v_checked_owner, v_checked_def
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order'
    AND p.pronargs = 24
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb, p_customer_phone text, p_shipping_fee numeric, p_discount_amount numeric, p_tax_amount numeric, p_payment_method text, p_payment_status text, p_shipping_status text, p_shipping_address jsonb, p_source text, p_notes text, p_ad_tracking jsonb, p_selected_quote_id uuid, p_shipping_provider text, p_tracking_number text, p_user_id uuid, p_tax_basis text, p_gift_wrapping_fee numeric, p_expected_total numeric, p_checkout_idempotency_key text, p_checkout_request_hash text';
  IF v_checked_def IS NULL THEN
    RAISE EXCEPTION 'storefront_order_function_not_found';
  END IF;
  IF md5(v_checked_def) <> 'cbb7f92e90a128c1fea05640d616ba09' THEN
    RAISE EXCEPTION 'storefront_order_squash_pre_image_mismatch'
      USING DETAIL = 'private.create_storefront_order(24) differs from the pinned bytes';
  END IF;
  -- pg_get_functiondef omits owner and EXECUTE ACL, so pin the 20260828
  -- shape explicitly: postgres owner, EXECUTE for the three service
  -- callers, and no PUBLIC grant (NULL proacl would also grant PUBLIC
  -- via defaults, so it fails closed too).
  IF pg_catalog.pg_get_userbyid(v_checked_owner) <> 'postgres' THEN
    RAISE EXCEPTION 'storefront_order_squash_privilege_mismatch'
      USING DETAIL = 'pre-image: private.create_storefront_order(24) owner is not postgres';
  END IF;
  IF NOT (pg_catalog.has_function_privilege('anon', v_checked_oid, 'EXECUTE')
      AND pg_catalog.has_function_privilege('authenticated', v_checked_oid, 'EXECUTE')
      AND pg_catalog.has_function_privilege('service_role', v_checked_oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'storefront_order_squash_privilege_mismatch'
      USING DETAIL = 'pre-image: private.create_storefront_order(24) EXECUTE grants differ (want anon, authenticated, service_role)';
  END IF;
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_checked_oid) IS NULL
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode((SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_checked_oid)) AS a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      ) THEN
    RAISE EXCEPTION 'storefront_order_squash_privilege_mismatch'
      USING DETAIL = 'pre-image: private.create_storefront_order(24) is executable by PUBLIC';
  END IF;

  SELECT p.oid, p.proowner, pg_catalog.pg_get_functiondef(p.oid)
    INTO v_unchecked_oid, v_unchecked_owner, v_unchecked_def
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order_unchecked'
    AND p.pronargs = 24
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb, p_customer_phone text, p_shipping_fee numeric, p_discount_amount numeric, p_tax_amount numeric, p_payment_method text, p_payment_status text, p_shipping_status text, p_shipping_address jsonb, p_source text, p_notes text, p_ad_tracking jsonb, p_selected_quote_id uuid, p_shipping_provider text, p_tracking_number text, p_user_id uuid, p_tax_basis text, p_gift_wrapping_fee numeric, p_expected_total numeric, p_checkout_idempotency_key text, p_checkout_request_hash text';
  IF v_unchecked_def IS NULL THEN
    RAISE EXCEPTION 'storefront_order_function_not_found';
  END IF;
  IF md5(v_unchecked_def) <> '0ac27900ce2d27f5b8f0c66f78fd2d32' THEN
    RAISE EXCEPTION 'storefront_order_squash_pre_image_mismatch'
      USING DETAIL = 'private.create_storefront_order_unchecked(24) differs from the pinned bytes';
  END IF;
  IF pg_catalog.pg_get_userbyid(v_unchecked_owner) <> 'postgres' THEN
    RAISE EXCEPTION 'storefront_order_squash_privilege_mismatch'
      USING DETAIL = 'pre-image: private.create_storefront_order_unchecked(24) owner is not postgres';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_unchecked_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', v_unchecked_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', v_unchecked_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'storefront_order_squash_privilege_mismatch'
      USING DETAIL = 'pre-image: private.create_storefront_order_unchecked(24) must be owner-only EXECUTE';
  END IF;
END;
$squash_guard$;

CREATE OR REPLACE FUNCTION private.create_storefront_order(p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb, p_customer_phone text DEFAULT NULL::text, p_shipping_fee numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_tax_amount numeric DEFAULT 0, p_payment_method text DEFAULT 'card'::text, p_payment_status text DEFAULT 'unpaid'::text, p_shipping_status text DEFAULT 'pending'::text, p_shipping_address jsonb DEFAULT NULL::jsonb, p_source text DEFAULT 'online_store'::text, p_notes text DEFAULT NULL::text, p_ad_tracking jsonb DEFAULT NULL::jsonb, p_selected_quote_id uuid DEFAULT NULL::uuid, p_shipping_provider text DEFAULT NULL::text, p_tracking_number text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid, p_tax_basis text DEFAULT 'exclusive'::text, p_gift_wrapping_fee numeric DEFAULT 0, p_expected_total numeric DEFAULT NULL::numeric, p_checkout_idempotency_key text DEFAULT NULL::text, p_checkout_request_hash text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, order_number text, tracking_token text, subtotal numeric, shipping_fee numeric, discount_amount numeric, tax_amount numeric, total numeric, customer_id uuid, customer_email text, customer_name text, customer_phone text, payment_status text, shipping_status text, payment_method text, shipping_address jsonb, merchant_id uuid, tax_basis text, gift_wrapping_fee numeric, idempotency_replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- A transaction-local marker lets the update trigger distinguish the
  -- private idempotent replay update from other pending-order updates.  The
  -- original implementation is private and revoked below; all public wrappers
  -- continue to resolve through this guarded delegate.
  PERFORM pg_catalog.set_config(
    'baci.storefront_order_replay_context',
    'create_storefront_order',
    true
  );

  RETURN QUERY
  SELECT *
  FROM private.create_storefront_order_unchecked(
    p_merchant_id,
    p_customer_email,
    p_customer_name,
    p_items,
    p_customer_phone,
    p_shipping_fee,
    p_discount_amount,
    p_tax_amount,
    p_payment_method,
    p_payment_status,
    p_shipping_status,
    p_shipping_address,
    p_source,
    p_notes,
    p_ad_tracking,
    p_selected_quote_id,
    p_shipping_provider,
    p_tracking_number,
    p_user_id,
    p_tax_basis,
    p_gift_wrapping_fee,
    p_expected_total,
    p_checkout_idempotency_key,
    p_checkout_request_hash
  );
END;
$function$;
CREATE OR REPLACE FUNCTION private.create_storefront_order_unchecked(p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb, p_customer_phone text DEFAULT NULL::text, p_shipping_fee numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_tax_amount numeric DEFAULT 0, p_payment_method text DEFAULT 'card'::text, p_payment_status text DEFAULT 'unpaid'::text, p_shipping_status text DEFAULT 'pending'::text, p_shipping_address jsonb DEFAULT NULL::jsonb, p_source text DEFAULT 'online_store'::text, p_notes text DEFAULT NULL::text, p_ad_tracking jsonb DEFAULT NULL::jsonb, p_selected_quote_id uuid DEFAULT NULL::uuid, p_shipping_provider text DEFAULT NULL::text, p_tracking_number text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid, p_tax_basis text DEFAULT 'exclusive'::text, p_gift_wrapping_fee numeric DEFAULT 0, p_expected_total numeric DEFAULT NULL::numeric, p_checkout_idempotency_key text DEFAULT NULL::text, p_checkout_request_hash text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, order_number text, tracking_token text, subtotal numeric, shipping_fee numeric, discount_amount numeric, tax_amount numeric, total numeric, customer_id uuid, customer_email text, customer_name text, customer_phone text, payment_status text, shipping_status text, payment_method text, shipping_address jsonb, merchant_id uuid, tax_basis text, gift_wrapping_fee numeric, idempotency_replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order_id UUID;
  v_order_number TEXT;
  v_tracking_token TEXT;
  v_customer_id UUID;
  v_first_name TEXT;
  v_last_name TEXT;
  v_trimmed_customer_name TEXT := trim(p_customer_name);
  v_normalized_customer_email TEXT := lower(trim(p_customer_email));
  v_normalized_customer_phone TEXT := NULLIF(trim(COALESCE(p_customer_phone, '')), '');
  v_subtotal NUMERIC := 0;
  v_shipping_fee NUMERIC := COALESCE(p_shipping_fee, 0);
  v_discount_amount NUMERIC := GREATEST(COALESCE(p_discount_amount, 0), 0);
  v_tax_amount NUMERIC := COALESCE(p_tax_amount, 0);
  v_gift_wrapping_fee NUMERIC := COALESCE(p_gift_wrapping_fee, 0);
  v_tax_basis TEXT := lower(trim(COALESCE(p_tax_basis, 'exclusive')));
  v_merchant_vat_status TEXT;
  v_merchant_vat_rate NUMERIC;
  v_expected_tax NUMERIC;
  -- Multi-country delta: order currency, defaulting to Naira until the merchant
  -- payout currency is read below.
  v_currency TEXT := 'NGN';
  v_total NUMERIC := 0;
  v_payment_method TEXT := p_payment_method;
  v_payment_status TEXT := 'unpaid';
  v_shipping_status TEXT := p_shipping_status;
  v_shipping_address JSONB := p_shipping_address;
  v_user_id UUID := auth.uid();
  v_customer_record_phone TEXT;
  v_invalid_item_count INTEGER;
  v_invalid_quantity_count INTEGER;
  v_invalid_variant_count INTEGER;
  v_retry_attempt INT := 0;
  v_checkout_idempotency_key TEXT := NULLIF(trim(COALESCE(p_checkout_idempotency_key, '')), '');
  v_checkout_request_hash TEXT := NULLIF(trim(COALESCE(p_checkout_request_hash, '')), '');
  v_existing_order RECORD;
  v_idempotency_replayed BOOLEAN := false;
  stock_rec RECORD;
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required';
  END IF;

  IF p_customer_email IS NULL OR trim(p_customer_email) = '' THEN
    RAISE EXCEPTION 'customer_email_required';
  END IF;

  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'customer_name_required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items_required';
  END IF;

  IF public.is_agentic_checkout_context() THEN
    p_user_id := NULL;
  ELSIF v_user_id IS NOT NULL THEN
    IF p_user_id IS NULL THEN
      p_user_id := v_user_id;
    ELSIF p_user_id <> v_user_id THEN
      RAISE EXCEPTION 'user_id_mismatch';
    END IF;
  ELSIF p_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'cannot_set_user_id_anonymously';
  END IF;

  IF p_payment_status IS NOT NULL AND trim(p_payment_status) <> '' THEN
    v_payment_status := lower(trim(p_payment_status));

    IF v_payment_status NOT IN ('unpaid', 'pending') THEN
      RAISE EXCEPTION 'invalid_payment_status';
    END IF;
  END IF;

  IF p_shipping_provider IS NOT NULL AND p_selected_quote_id IS NULL THEN
    RAISE EXCEPTION 'shipping_quote_required';
  END IF;

  IF v_tax_basis NOT IN ('exclusive', 'inclusive') THEN
    RAISE EXCEPTION 'invalid_tax_basis';
  END IF;

  v_tax_basis := 'exclusive';

  IF v_gift_wrapping_fee < 0 THEN
    RAISE EXCEPTION 'gift_wrapping_fee_negative';
  END IF;

  PERFORM 1 FROM public.merchants m WHERE m.id = p_merchant_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merchant_not_found';
  END IF;

  IF v_checkout_idempotency_key IS NOT NULL THEN
    IF v_checkout_request_hash IS NULL THEN
      RAISE EXCEPTION 'checkout_request_hash_required';
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        p_merchant_id::text || ':checkout:' || v_checkout_idempotency_key,
        0
      )
    );

    SELECT
      o.id,
      o.order_number,
      o.tracking_token,
      o.subtotal,
      o.shipping_fee,
      o.discount_amount,
      o.tax_amount,
      o.total,
      o.customer_id,
      o.customer_email,
      o.customer_name,
      o.customer_phone,
      o.payment_status,
      o.shipping_status,
      o.payment_method,
      o.shipping_address,
      o.merchant_id,
      o.tax_basis,
      o.gift_wrapping_fee,
      o.checkout_request_hash
    INTO v_existing_order
    FROM public.orders o
    WHERE o.merchant_id = p_merchant_id
      AND o.checkout_idempotency_key = v_checkout_idempotency_key
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_order.checkout_request_hash IS DISTINCT FROM v_checkout_request_hash THEN
        RAISE EXCEPTION 'checkout_idempotency_conflict';
      END IF;

      IF v_existing_order.payment_status IN ('paid', 'bnpl_approved', 'refunded')
        OR COALESCE(v_existing_order.shipping_status, '') IN (
          'processing',
          'shipped',
          'out_for_delivery',
          'delivered',
          'completed',
          'cancelled'
        )
      THEN
        RAISE EXCEPTION 'order_not_reusable';
      END IF;

      UPDATE public.orders o
      SET
        payment_method = trim(p_payment_method),
        payment_status = v_payment_status,
        shipping_status = 'pending',
        updated_at = now()
      WHERE o.id = v_existing_order.id
      RETURNING
        o.id,
        o.order_number,
        o.tracking_token,
        o.subtotal,
        o.shipping_fee,
        o.discount_amount,
        o.tax_amount,
        o.total,
        o.customer_id,
        o.customer_email,
        o.customer_name,
        o.customer_phone,
        o.payment_status,
        o.shipping_status,
        o.payment_method,
        o.shipping_address,
        o.merchant_id,
        o.tax_basis,
        o.gift_wrapping_fee,
        o.checkout_request_hash
      INTO v_existing_order;

      RETURN QUERY
      SELECT
        v_existing_order.id,
        v_existing_order.order_number,
        v_existing_order.tracking_token,
        v_existing_order.subtotal,
        v_existing_order.shipping_fee,
        v_existing_order.discount_amount,
        v_existing_order.tax_amount,
        v_existing_order.total,
        v_existing_order.customer_id,
        v_existing_order.customer_email,
        v_existing_order.customer_name,
        v_existing_order.customer_phone,
        v_existing_order.payment_status,
        v_existing_order.shipping_status,
        v_existing_order.payment_method,
        v_existing_order.shipping_address,
        v_existing_order.merchant_id,
        v_existing_order.tax_basis,
        v_existing_order.gift_wrapping_fee,
        true;
      RETURN;
    END IF;
  END IF;

  v_first_name := split_part(v_trimmed_customer_name, ' ', 1);
  IF position(' ' in v_trimmed_customer_name) > 0 THEN
    v_last_name := trim(substring(v_trimmed_customer_name from position(' ' in v_trimmed_customer_name) + 1));
  ELSE
    v_last_name := NULL;
  END IF;

  -- Deterministic catalog locks keep reviewed prices and stock pools stable
  -- until the order and its inventory transition commit together.
  PERFORM p.id FROM public.products p WHERE p.merchant_id=p_merchant_id AND p.id IN (
    SELECT coalesce(nullif(item->>'product_id',''),nullif(item->>'productId',''),nullif(item->>'id',''))::uuid FROM jsonb_array_elements(p_items) item
  ) ORDER BY p.id FOR UPDATE;
  PERFORM v.id FROM public.product_variants v JOIN public.products p ON p.id=v.product_id AND p.merchant_id=v.merchant_id
   WHERE p.merchant_id=p_merchant_id AND v.id IN(SELECT nullif(item->>'variant_id','')::uuid FROM jsonb_array_elements(p_items) item)
   ORDER BY v.id FOR UPDATE OF v;
  PERFORM offer.id FROM public.product_offers offer JOIN public.products p ON p.id=offer.product_id AND p.merchant_id=offer.merchant_id
   WHERE p.merchant_id=p_merchant_id AND p.id IN(SELECT coalesce(nullif(item->>'product_id',''),nullif(item->>'productId',''),nullif(item->>'id',''))::uuid FROM jsonb_array_elements(p_items) item)
   ORDER BY offer.id FOR UPDATE OF offer;
  DROP TABLE IF EXISTS pg_temp.tmp_storefront_order_items;

  CREATE TEMP TABLE tmp_storefront_order_items (
    product_id UUID,
    condition TEXT,
    image_url TEXT,
    variant_id UUID,
    variant_attributes JSONB,
    variant_name TEXT,
    quantity INTEGER,
    has_assurance BOOLEAN,
    assurance_fee NUMERIC,
    product_name TEXT,
    base_price NUMERIC,
    price_override NUMERIC,
    manage_stock BOOLEAN,
    variant_stock INTEGER,
    condition_offer_id UUID,
    condition_valid BOOLEAN,
    submitted_price NUMERIC,
    voucher_award_id text,
    offer_id UUID,
    offer_condition TEXT,
    offer_grade TEXT,
    offer_condition_notes TEXT,
    offer_labels_snapshotted BOOLEAN
  ) ON COMMIT DROP;

  INSERT INTO tmp_storefront_order_items (
    product_id,
    condition,
    image_url,
    variant_id,
    variant_attributes,
    variant_name,
    quantity,
    has_assurance,
    assurance_fee,
    product_name,
    base_price,
    price_override,
    manage_stock,
    variant_stock, condition_offer_id, condition_valid, submitted_price, voucher_award_id,
    offer_id, offer_condition, offer_grade, offer_condition_notes,
    offer_labels_snapshotted
  )
  SELECT
    r.product_id,
    COALESCE(NULLIF(trim(r.condition), ''), p.condition),
    r.image_url,
    r.variant_id,
    r.variant_attributes,
    COALESCE(
      public.format_order_item_variant_name(v.attributes),
      NULLIF(trim(r.variant_name), ''),
      public.format_order_item_variant_name(r.variant_attributes)
    ),
    r.quantity,
    r.has_assurance,
    r.assurance_fee,
    p.name,
    CASE WHEN offer.id IS NOT NULL THEN offer.price ELSE p.price END,
    v.price_override,
    p.manage_stock,
    v.stock_quantity,
    offer.id,
    CASE WHEN r.variant_id IS NOT NULL OR r.condition IS NULL THEN true
      WHEN offer.id IS NOT NULL THEN offer.status='active' AND public.commerce_cart_condition_pool_is_quantity_managed(p_merchant_id,p.id) AND EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=p_merchant_id AND (coalesce(m.is_published,false) OR coalesce(m.is_platform_admin,false)))
      ELSE discovery.canonical_product_condition(r.condition)=discovery.canonical_product_condition(p.condition)
    END,
    r.submitted_price,r.voucher_award_id,
    r.offer_id,
    offer.condition,
    offer.grade,
    offer.condition_notes,
    offer.id IS NOT NULL
  FROM (
    SELECT
      COALESCE(
        NULLIF(item->>'product_id','')::uuid,
        NULLIF(item->>'productId','')::uuid,
        NULLIF(item->>'id','')::uuid
      ) AS product_id,
      NULLIF(trim(item->>'condition'), '') AS condition,
      nullif(item->>'price','')::numeric AS submitted_price,
      nullif(item->>'voucher_award_id','') AS voucher_award_id,
      NULLIF(item->>'offer_id','')::uuid AS offer_id,
      NULLIF(trim(COALESCE(item->>'image_url', item->>'imageUrl')), '') AS image_url,
      NULLIF(item->>'variant_id','')::uuid AS variant_id,
      COALESCE(item->'variant_attributes', item->'variantAttributes') AS variant_attributes,
      NULLIF(trim(COALESCE(item->>'variant_name', item->>'variantName')), '') AS variant_name,
      (item->>'quantity')::int AS quantity,
      COALESCE((item->>'has_assurance')::boolean, false) AS has_assurance,
      GREATEST(COALESCE((item->>'assurance_fee')::numeric, 0), 0) AS assurance_fee
    FROM jsonb_array_elements(p_items) AS item
  ) AS r
  LEFT JOIN public.products p ON p.id = r.product_id
    AND p.merchant_id = p_merchant_id
    AND p.status = 'active'
  LEFT JOIN public.product_variants v
    ON r.variant_id IS NOT NULL
    AND v.id = r.variant_id
    AND v.product_id = p.id AND v.merchant_id=p_merchant_id
    
    AND NOT coalesce((to_jsonb(v)->>'is_inventory_anchor')::boolean,false)
  LEFT JOIN public.product_offers offer ON offer.product_id=p.id AND offer.merchant_id=p_merchant_id
    AND ((r.variant_id IS NULL AND r.condition IS NOT NULL AND offer.condition=r.condition)
      OR (r.variant_id IS NULL AND r.condition IS NULL AND r.offer_id IS NOT NULL AND offer.id=r.offer_id AND offer.status='active'));

  SELECT
    COUNT(*) FILTER (WHERE t.product_id IS NULL OR t.product_name IS NULL) AS invalid_item_count,
    COUNT(*) FILTER (WHERE t.quantity IS NULL OR t.quantity <= 0) AS invalid_quantity_count,
    COUNT(*) FILTER (
      WHERE t.variant_id IS NOT NULL AND t.variant_stock IS NULL
    ) AS invalid_variant_count
  INTO v_invalid_item_count, v_invalid_quantity_count, v_invalid_variant_count
  FROM tmp_storefront_order_items t;

  IF v_invalid_item_count > 0 THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;

  IF v_invalid_quantity_count > 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  IF v_invalid_variant_count > 0 THEN
    RAISE EXCEPTION 'invalid_variant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_storefront_order_items t
    WHERE t.offer_id IS NOT NULL
      AND (
        t.variant_id IS NOT NULL
        OR t.offer_id IS DISTINCT FROM t.condition_offer_id
      )
  ) THEN
    RAISE EXCEPTION 'invalid_offer';
  END IF;

  IF EXISTS(SELECT 1 FROM tmp_storefront_order_items t WHERE t.condition_valid IS NOT TRUE) THEN RAISE EXCEPTION 'invalid_condition_offer'; END IF;
  -- Condition clients must echo the same offer they reviewed. Voucher lines
  -- remain zero-priced by the verified voucher wrapper and are charged via
  -- its established award discount/reserved-order contract.
  IF EXISTS(SELECT 1 FROM tmp_storefront_order_items t WHERE t.condition_offer_id IS NOT NULL
    AND t.voucher_award_id IS NULL AND t.submitted_price IS NOT NULL
    AND t.submitted_price IS DISTINCT FROM coalesce(t.price_override,t.base_price)
    AND NOT(public.commerce_cart_product_negotiable(p_merchant_id,t.product_id) AND t.submitted_price>0 AND t.submitted_price<coalesce(t.price_override,t.base_price) AND (coalesce(t.price_override,t.base_price)-t.submitted_price)*100<=coalesce(t.price_override,t.base_price)*2)) THEN RAISE EXCEPTION 'condition_offer_price_changed'; END IF;
  SELECT COALESCE(SUM((COALESCE(t.price_override, t.base_price) * t.quantity) + t.assurance_fee), 0)
    INTO v_subtotal
  FROM tmp_storefront_order_items t;

  v_shipping_fee := GREATEST(v_shipping_fee, 0);
  v_tax_amount := GREATEST(v_tax_amount, 0);

  -- Multi-country delta: read the merchant payout currency alongside the existing
  -- VAT lookup; falls back to Naira when the payout currency is blank/unset.
  SELECT
    COALESCE(m.vat_registration_status, 'not_registered'),
    COALESCE(m.vat_rate, 7.5),
    public.commerce_cart_resolve_merchant_currency(to_jsonb(m)->>'payout_currency',to_jsonb(m)->>'country')
    INTO v_merchant_vat_status, v_merchant_vat_rate, v_currency
  FROM public.merchants m
  WHERE m.id = p_merchant_id;

  IF v_merchant_vat_status = 'registered' THEN
    IF v_tax_basis = 'exclusive' THEN
      SELECT COALESCE(SUM(
        CASE
          WHEN COALESCE(p.vat_category_code, 'S') = 'S' THEN
            ROUND(
              ROUND(
                t.quantity * COALESCE(t.price_override, t.base_price),
                2
              )
              * COALESCE(p.vat_rate, 7.5) / 100,
              2
            )
          ELSE 0
        END
      ), 0)
        INTO v_expected_tax
      FROM tmp_storefront_order_items t
      JOIN public.products p ON p.id = t.product_id;

      IF ABS(v_tax_amount - v_expected_tax) > 1 THEN
        RAISE EXCEPTION 'tax_amount_mismatch'
          USING DETAIL = format(
            'expected=%s got=%s subtotal=%s vat_rate=%s',
            v_expected_tax, v_tax_amount, v_subtotal, v_merchant_vat_rate
          );
      END IF;
    END IF;
  ELSE
    IF v_tax_amount > 1 THEN
      RAISE EXCEPTION 'tax_amount_must_be_zero_for_non_vat_merchant'
        USING DETAIL = format('got=%s', v_tax_amount);
    END IF;
    v_tax_amount := 0;
  END IF;

  IF v_tax_basis = 'exclusive' THEN
    v_total :=
      v_subtotal
      + v_shipping_fee
      + v_gift_wrapping_fee
      + v_tax_amount
      - v_discount_amount;
  ELSE
    v_total :=
      v_subtotal
      + v_shipping_fee
      + v_gift_wrapping_fee
      - v_discount_amount;
  END IF;

  IF v_total < 0 THEN
    v_total := 0;
  END IF;

  IF p_expected_total IS NOT NULL
    AND ABS(v_total - p_expected_total) > 1
  THEN
    RAISE EXCEPTION 'order_total_mismatch'
      USING DETAIL = format(
        'expected=%s computed=%s subtotal=%s shipping=%s gift=%s tax=%s discount=%s basis=%s',
        p_expected_total, v_total, v_subtotal, v_shipping_fee,
        v_gift_wrapping_fee, v_tax_amount, v_discount_amount, v_tax_basis
      );
  END IF;

  IF v_normalized_customer_phone IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(p_merchant_id::text),
      hashtext(v_normalized_customer_phone)
    );
  END IF;

  IF p_user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_merchant_id::text || ':' || p_user_id::text, 0)
    );
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_merchant_id::text || ':' || v_normalized_customer_email, 1
    )
  );

  IF p_user_id IS NOT NULL THEN
    SELECT c.id
      INTO v_customer_id
    FROM public.customers c
    WHERE c.merchant_id = p_merchant_id
      AND c.user_id = p_user_id
    ORDER BY c.id
    LIMIT 1
    FOR UPDATE;
  END IF;

  -- Δ-97 / Codex P1: phone-only fallback is restricted to GUEST
  -- checkouts (p_user_id IS NULL). Phone numbers are recycled by
  -- telcos (NIST SP 800-63B AAL1); auto-claiming an existing
  -- customer row from an authed checkout based on phone alone
  -- would let one auth user inherit a stranger's order history.
  IF v_customer_id IS NULL
    AND v_normalized_customer_phone IS NOT NULL
    AND p_user_id IS NULL
  THEN
    SELECT c.id
      INTO v_customer_id
    FROM public.customers c
    WHERE c.merchant_id = p_merchant_id
      AND c.phone = v_normalized_customer_phone
      AND c.user_id IS NULL
    ORDER BY c.id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_customer_id IS NULL THEN
    SELECT c.id
      INTO v_customer_id
    FROM public.customers c
    WHERE c.merchant_id = p_merchant_id
      AND lower(c.email) = v_normalized_customer_email
    ORDER BY c.id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.customers c
    SET
      email = CASE
        WHEN (c.email IS NULL OR c.email = '')
          AND NOT EXISTS (
            SELECT 1
            FROM public.customers existing_email
            WHERE existing_email.merchant_id = p_merchant_id
              AND lower(existing_email.email) = v_normalized_customer_email
              AND existing_email.id <> c.id
          )
          THEN v_normalized_customer_email
        ELSE c.email
      END,
      phone = CASE
        WHEN v_normalized_customer_phone IS NULL THEN c.phone
        WHEN c.phone = v_normalized_customer_phone THEN c.phone
        WHEN NOT EXISTS (
          SELECT 1
          FROM public.customers existing_phone
          WHERE existing_phone.merchant_id = p_merchant_id
            AND existing_phone.phone = v_normalized_customer_phone
            AND existing_phone.id <> c.id
        )
          THEN v_normalized_customer_phone
        ELSE c.phone
      END,
      user_id = CASE
        WHEN c.user_id IS NULL THEN p_user_id
        ELSE c.user_id
      END,
      first_name = COALESCE(c.first_name, v_first_name),
      last_name = COALESCE(c.last_name, v_last_name),
      updated_at = now()
    WHERE c.id = v_customer_id
    RETURNING c.id INTO v_customer_id;
  ELSE
    v_customer_record_phone := v_normalized_customer_phone;

    IF v_normalized_customer_phone IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.customers existing_phone
        WHERE existing_phone.merchant_id = p_merchant_id
          AND existing_phone.phone = v_normalized_customer_phone
      )
    THEN
      v_customer_record_phone := NULL;
    END IF;

    v_retry_attempt := 0;
    LOOP
      v_retry_attempt := v_retry_attempt + 1;
      IF v_retry_attempt > 3 THEN
        RAISE EXCEPTION 'customer_upsert_failed'
          USING HINT = 'Exhausted 3 retry attempts on customer upsert';
      END IF;

      BEGIN
        INSERT INTO public.customers (
          merchant_id,
          email,
          first_name,
          last_name,
          phone,
          user_id
        )
        VALUES (
          p_merchant_id,
          v_normalized_customer_email,
          v_first_name,
          v_last_name,
          v_customer_record_phone,
          p_user_id
        )
        RETURNING customers.id INTO v_customer_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_customer_id := NULL;
        SELECT c.id INTO v_customer_id
        FROM public.customers c
        WHERE c.merchant_id = p_merchant_id
          AND (
            (p_user_id IS NOT NULL AND c.user_id = p_user_id)
            OR lower(c.email) = v_normalized_customer_email
          )
        ORDER BY
          CASE
            WHEN p_user_id IS NOT NULL AND c.user_id = p_user_id THEN 0
            ELSE 1
          END,
          c.id
        LIMIT 1;

        IF v_customer_id IS NOT NULL THEN
          UPDATE public.customers c
          SET
            phone = COALESCE(c.phone, v_customer_record_phone),
            user_id = COALESCE(c.user_id, p_user_id),
            first_name = COALESCE(c.first_name, v_first_name),
            last_name = COALESCE(c.last_name, v_last_name),
            email = COALESCE(NULLIF(c.email, ''), v_normalized_customer_email),
            updated_at = now()
          WHERE c.id = v_customer_id;
          EXIT;
        END IF;
      END;
    END LOOP;
  END IF;

  INSERT INTO public.orders (
    merchant_id,
    customer_id,
    customer_email,
    customer_name,
    customer_phone,
    subtotal,
    shipping_fee,
    discount_amount,
    tax_amount,
    total,
    currency,
    payment_method,
    payment_status,
    shipping_status,
    shipping_address,
    source,
    notes,
    ad_tracking,
    selected_quote_id,
    shipping_provider,
    tracking_number,
    tax_basis,
    gift_wrapping_fee,
    checkout_idempotency_key,
    checkout_request_hash
  )
  VALUES (
    p_merchant_id,
    v_customer_id,
    v_normalized_customer_email,
    v_trimmed_customer_name,
    v_normalized_customer_phone,
    v_subtotal,
    v_shipping_fee,
    v_discount_amount,
    v_tax_amount,
    v_total,
    v_currency,
    v_payment_method,
    v_payment_status,
    v_shipping_status,
    v_shipping_address,
    p_source,
    p_notes,
    p_ad_tracking,
    p_selected_quote_id,
    p_shipping_provider,
    p_tracking_number,
    v_tax_basis,
    v_gift_wrapping_fee,
    v_checkout_idempotency_key,
    v_checkout_request_hash
  )
  RETURNING
    orders.id,
    orders.order_number,
    orders.tracking_token,
    orders.payment_method,
    orders.shipping_status,
    orders.shipping_address
  INTO
    v_order_id,
    v_order_number,
    v_tracking_token,
    v_payment_method,
    v_shipping_status,
    v_shipping_address;

  FOR stock_rec IN
    SELECT
      t.product_id,
      t.variant_id,
      t.condition_offer_id,
      SUM(t.quantity)::INTEGER AS total_quantity,
      BOOL_OR(t.manage_stock) AS manage_stock
    FROM tmp_storefront_order_items t
    GROUP BY t.product_id, t.variant_id, t.condition_offer_id
    ORDER BY t.product_id, t.variant_id, t.condition_offer_id
  LOOP
    IF stock_rec.condition_offer_id IS NOT NULL THEN
      UPDATE public.product_offers offer SET stock_quantity=offer.stock_quantity-stock_rec.total_quantity
      WHERE offer.id=stock_rec.condition_offer_id AND offer.merchant_id=p_merchant_id AND offer.product_id=stock_rec.product_id
        AND offer.status='active' AND offer.stock_quantity>=stock_rec.total_quantity;
      IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_condition_offer_stock'; END IF;
      CONTINUE;
    END IF;
    IF stock_rec.manage_stock THEN
      -- Verify tracking policy to bypass legacy decrement for serialized inventory
      DECLARE
        v_prod_policy TEXT;
        v_var_policy TEXT;
        v_effective_policy TEXT;
        v_variant_id UUID := stock_rec.variant_id;
      BEGIN
        SELECT inventory_tracking_policy INTO v_prod_policy
        FROM public.products
        WHERE products.id = stock_rec.product_id;

        IF v_variant_id IS NOT NULL THEN
          SELECT inventory_tracking_policy INTO v_var_policy
          FROM public.product_variants
          WHERE product_variants.id = v_variant_id;
        ELSE
          v_var_policy := 'inherit';
        END IF;

        v_effective_policy := public.get_effective_inventory_tracking_policy(v_prod_policy, v_var_policy);

        IF v_effective_policy IN ('serialized_strict', 'serialized_then_unlimited') THEN
          -- Bypassed legacy stock decrement for serialized inventory tracking
          CONTINUE;
        END IF;
      END;

      IF stock_rec.variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock_quantity = stock_quantity - stock_rec.total_quantity
        WHERE product_variants.id = stock_rec.variant_id
          AND stock_quantity >= stock_rec.total_quantity;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'insufficient_variant_stock';
        END IF;
      ELSE
        UPDATE public.products
        SET stock_quantity = stock_quantity - stock_rec.total_quantity
        WHERE public.products.id = stock_rec.product_id
          AND stock_quantity >= stock_rec.total_quantity;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'insufficient_stock';
        END IF;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    condition,
    image_url,
    variant_id,
    variant_name,
    name,
    price,
    quantity,
    has_assurance,
    assurance_fee,
    variant_attributes,
    product_offer_id,
    offer_id,
    offer_line,
    offer_grade,
    offer_condition_notes,
    offer_labels_snapshotted
  )
  SELECT
    v_order_id,
    t.product_id,
    COALESCE(t.offer_condition, t.condition),
    t.image_url,
    t.variant_id,
    t.variant_name,
    t.product_name,
    COALESCE(t.price_override, t.base_price),
    t.quantity,
    t.has_assurance,
    t.assurance_fee,
    COALESCE(t.variant_attributes, '{}'::jsonb),
    t.condition_offer_id,
    t.offer_id,
    (t.offer_id IS NOT NULL OR t.condition_offer_id IS NOT NULL) AS offer_line,
    t.offer_grade,
    t.offer_condition_notes,
    t.offer_labels_snapshotted
  FROM tmp_storefront_order_items t;

  -- Claim serialized units for newly created order items
  DECLARE
    v_item RECORD;
  BEGIN
    FOR v_item IN
      SELECT oi.id, oi.product_id, oi.variant_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order_id
        AND NOT EXISTS(SELECT 1 FROM pg_temp.tmp_storefront_order_items t WHERE t.condition_offer_id IS NOT NULL AND t.product_id=oi.product_id AND t.variant_id IS NOT DISTINCT FROM oi.variant_id AND t.condition IS NOT DISTINCT FROM oi.condition)
      ORDER BY oi.product_id, oi.variant_id, oi.id
    LOOP
      PERFORM private.claim_variant_inventory_units_for_order_item_internal(
        p_merchant_id,
        v_order_id,
        v_item.id
      );
    END LOOP;
  END;

  SELECT o.total, o.tax_amount
    INTO v_total, v_tax_amount
  FROM public.orders o
  WHERE o.id = v_order_id;

  RETURN QUERY
  SELECT
    v_order_id,
    v_order_number,
    v_tracking_token,
    v_subtotal,
    v_shipping_fee,
    v_discount_amount,
    v_tax_amount,
    v_total,
    v_customer_id,
    v_normalized_customer_email,
    v_trimmed_customer_name,
    v_normalized_customer_phone,
    v_payment_status,
    v_shipping_status,
    v_payment_method,
    v_shipping_address,
    p_merchant_id,
    v_tax_basis,
    v_gift_wrapping_fee,
    v_idempotency_replayed;
END;
$function$;

DO $squash_post_guard$
DECLARE
  v_checked_oid oid;
  v_checked_owner oid;
  v_checked_def text;
  v_unchecked_oid oid;
  v_unchecked_owner oid;
  v_unchecked_def text;
BEGIN
  SELECT p.oid, p.proowner, pg_catalog.pg_get_functiondef(p.oid)
    INTO v_checked_oid, v_checked_owner, v_checked_def
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order'
    AND p.pronargs = 24
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb, p_customer_phone text, p_shipping_fee numeric, p_discount_amount numeric, p_tax_amount numeric, p_payment_method text, p_payment_status text, p_shipping_status text, p_shipping_address jsonb, p_source text, p_notes text, p_ad_tracking jsonb, p_selected_quote_id uuid, p_shipping_provider text, p_tracking_number text, p_user_id uuid, p_tax_basis text, p_gift_wrapping_fee numeric, p_expected_total numeric, p_checkout_idempotency_key text, p_checkout_request_hash text';
  IF v_checked_def IS NULL THEN
    RAISE EXCEPTION 'storefront_order_function_not_found'
      USING DETAIL = 'post-image lookup found no private.create_storefront_order(24)';
  END IF;
  IF md5(v_checked_def) <> 'cbb7f92e90a128c1fea05640d616ba09' THEN
    RAISE EXCEPTION 'storefront_order_squash_post_image_mismatch'
      USING DETAIL = 'installed private.create_storefront_order(24) differs from the pinned bytes';
  END IF;
  -- pg_get_functiondef omits owner and EXECUTE ACL, so pin the 20260828
  -- shape explicitly: postgres owner, EXECUTE for the three service
  -- callers, and no PUBLIC grant (NULL proacl would also grant PUBLIC
  -- via defaults, so it fails closed too).
  IF pg_catalog.pg_get_userbyid(v_checked_owner) <> 'postgres' THEN
    RAISE EXCEPTION 'storefront_order_squash_privilege_mismatch'
      USING DETAIL = 'post-image: private.create_storefront_order(24) owner is not postgres';
  END IF;
  IF NOT (pg_catalog.has_function_privilege('anon', v_checked_oid, 'EXECUTE')
      AND pg_catalog.has_function_privilege('authenticated', v_checked_oid, 'EXECUTE')
      AND pg_catalog.has_function_privilege('service_role', v_checked_oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'storefront_order_squash_privilege_mismatch'
      USING DETAIL = 'post-image: private.create_storefront_order(24) EXECUTE grants differ (want anon, authenticated, service_role)';
  END IF;
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_checked_oid) IS NULL
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode((SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_checked_oid)) AS a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      ) THEN
    RAISE EXCEPTION 'storefront_order_squash_privilege_mismatch'
      USING DETAIL = 'post-image: private.create_storefront_order(24) is executable by PUBLIC';
  END IF;

  SELECT p.oid, p.proowner, pg_catalog.pg_get_functiondef(p.oid)
    INTO v_unchecked_oid, v_unchecked_owner, v_unchecked_def
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order_unchecked'
    AND p.pronargs = 24
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb, p_customer_phone text, p_shipping_fee numeric, p_discount_amount numeric, p_tax_amount numeric, p_payment_method text, p_payment_status text, p_shipping_status text, p_shipping_address jsonb, p_source text, p_notes text, p_ad_tracking jsonb, p_selected_quote_id uuid, p_shipping_provider text, p_tracking_number text, p_user_id uuid, p_tax_basis text, p_gift_wrapping_fee numeric, p_expected_total numeric, p_checkout_idempotency_key text, p_checkout_request_hash text';
  IF v_unchecked_def IS NULL THEN
    RAISE EXCEPTION 'storefront_order_function_not_found'
      USING DETAIL = 'post-image lookup found no private.create_storefront_order_unchecked(24)';
  END IF;
  IF md5(v_unchecked_def) <> '0ac27900ce2d27f5b8f0c66f78fd2d32' THEN
    RAISE EXCEPTION 'storefront_order_squash_post_image_mismatch'
      USING DETAIL = 'installed private.create_storefront_order_unchecked(24) differs from the pinned bytes';
  END IF;
  IF pg_catalog.pg_get_userbyid(v_unchecked_owner) <> 'postgres' THEN
    RAISE EXCEPTION 'storefront_order_squash_privilege_mismatch'
      USING DETAIL = 'post-image: private.create_storefront_order_unchecked(24) owner is not postgres';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_unchecked_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', v_unchecked_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', v_unchecked_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'storefront_order_squash_privilege_mismatch'
      USING DETAIL = 'post-image: private.create_storefront_order_unchecked(24) must be owner-only EXECUTE';
  END IF;
END;
$squash_post_guard$;
