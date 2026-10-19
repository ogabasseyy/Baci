-- Durable pool lineage prevents cancellation/refund from restoring parent stock.
ALTER TABLE public.order_items ADD COLUMN product_offer_id uuid REFERENCES public.product_offers(id);
CREATE OR REPLACE FUNCTION private.enforce_order_item_product_offer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.product_offer_id IS NOT NULL THEN
  -- SHARE also serializes direct RLS-authorized item writes with an offer
  -- identity edit, including an edit that started before this line existed.
  PERFORM offer.id FROM public.product_offers offer JOIN public.orders orders ON orders.merchant_id=offer.merchant_id
  WHERE offer.id=NEW.product_offer_id AND orders.id=NEW.order_id AND offer.product_id=NEW.product_id AND offer.condition IS NOT DISTINCT FROM NEW.condition
  FOR SHARE OF offer;
  IF NOT FOUND OR NEW.variant_id IS NOT NULL THEN RAISE EXCEPTION 'order_item_condition_offer_mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_order_item_product_offer() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER enforce_order_item_product_offer BEFORE INSERT OR UPDATE OF product_offer_id,order_id,product_id,variant_id,condition ON public.order_items FOR EACH ROW EXECUTE FUNCTION private.enforce_order_item_product_offer();
-- An order's inventory destination is immutable after purchase; repricing and
-- publication/status edits remain available to the merchant.
CREATE OR REPLACE FUNCTION private.preserve_ordered_product_offer_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (NEW.merchant_id IS DISTINCT FROM OLD.merchant_id OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.condition IS DISTINCT FROM OLD.condition)
  AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.product_offer_id=OLD.id) THEN
  RAISE EXCEPTION 'ordered_product_offer_identity_immutable';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.preserve_ordered_product_offer_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER preserve_ordered_product_offer_identity BEFORE UPDATE OF merchant_id,product_id,condition ON public.product_offers FOR EACH ROW EXECUTE FUNCTION private.preserve_ordered_product_offer_identity();
-- Condition-aware order pricing and inventory; retain final replay-context wrapper.
-- Condition offers carry aggregate quantities only. No stored mapping binds
-- an offer to the hidden anchor's serialized units, so never bypass that policy.
CREATE OR REPLACE FUNCTION public.commerce_cart_condition_pool_is_quantity_managed(p_merchant_id uuid,p_product_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT public.get_effective_inventory_tracking_policy(coalesce(to_jsonb(product)->>'inventory_tracking_policy','off'),anchor.inventory_tracking_policy)
   NOT IN ('serialized_strict','serialized_then_unlimited')
 FROM public.products product LEFT JOIN public.product_variants anchor
  ON anchor.id=nullif(to_jsonb(product)->>'inventory_anchor_variant_id','')::uuid
  AND anchor.product_id=product.id AND anchor.merchant_id=product.merchant_id
 WHERE product.id=p_product_id AND product.merchant_id=p_merchant_id;
$$;
REVOKE ALL ON FUNCTION public.commerce_cart_condition_pool_is_quantity_managed(uuid,uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.commerce_cart_condition_supported(p_merchant_id uuid,p_product_id uuid,p_variant_id uuid,p_condition text)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT p_variant_id IS NOT NULL OR p_condition IS NULL OR EXISTS(
  SELECT 1 FROM public.products p WHERE p.id=p_product_id AND p.merchant_id=p_merchant_id
   AND CASE WHEN EXISTS(SELECT 1 FROM public.product_offers o WHERE o.product_id=p.id AND o.merchant_id=p.merchant_id AND o.condition=p_condition)
    THEN public.commerce_cart_condition_pool_is_quantity_managed(p_merchant_id,p_product_id) AND EXISTS(SELECT 1 FROM public.product_offers o JOIN public.merchants m ON m.id=o.merchant_id WHERE o.product_id=p.id AND o.merchant_id=p_merchant_id AND o.condition=p_condition AND o.status='active' AND (coalesce(m.is_published,false) OR coalesce(m.is_platform_admin,false)))
    ELSE discovery.canonical_product_condition(p_condition)=discovery.canonical_product_condition(coalesce(to_jsonb(p)->>'condition','new')) END
 );
$$;
CREATE OR REPLACE FUNCTION public.commerce_cart_offer_price_minor(p_merchant_id uuid,p_product_id uuid,p_variant_id uuid,p_condition text)
RETURNS bigint LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN p_variant_id IS NULL AND p_condition IS NOT NULL THEN coalesce((SELECT round(o.price*100)::bigint FROM public.product_offers o WHERE o.merchant_id=p_merchant_id AND o.product_id=p_product_id AND o.condition=p_condition AND o.status='active'),public.commerce_cart_offer_price_minor(p_merchant_id,p_product_id,p_variant_id)) ELSE public.commerce_cart_offer_price_minor(p_merchant_id,p_product_id,p_variant_id) END;
$$;
REVOKE ALL ON FUNCTION public.commerce_cart_offer_price_minor(uuid,uuid,uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.commerce_cart_negotiation_status(p_merchant_id uuid,p_product_id uuid,p_variant_id uuid,p_condition text,p_negotiated bigint,p_requested text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE catalog bigint:=public.commerce_cart_offer_price_minor(p_merchant_id,p_product_id,p_variant_id,p_condition);
BEGIN
 IF p_negotiated IS NULL THEN RETURN NULL; END IF;
 IF p_requested='rejected' THEN RETURN 'rejected'; END IF;
 IF p_requested='pending' THEN RETURN 'pending'; END IF;
 IF public.commerce_cart_product_negotiable(p_merchant_id,p_product_id) AND p_negotiated>0 AND p_negotiated<catalog AND (catalog-p_negotiated)::numeric*100<=catalog::numeric*2 THEN RETURN 'accepted'; END IF;
 RETURN 'pending';
END $$;
REVOKE ALL ON FUNCTION public.commerce_cart_negotiation_status(uuid,uuid,uuid,text,bigint,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.create_storefront_order_unchecked(
  p_merchant_id UUID,
  p_customer_email TEXT,
  p_customer_name TEXT,
  p_items JSONB,
  p_customer_phone TEXT DEFAULT NULL,
  p_shipping_fee NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_tax_amount NUMERIC DEFAULT 0,
  p_payment_method TEXT DEFAULT 'card',
  p_payment_status TEXT DEFAULT 'unpaid',
  p_shipping_status TEXT DEFAULT 'pending',
  p_shipping_address JSONB DEFAULT NULL,
  p_source TEXT DEFAULT 'online_store',
  p_notes TEXT DEFAULT NULL,
  p_ad_tracking JSONB DEFAULT NULL,
  p_selected_quote_id UUID DEFAULT NULL,
  p_shipping_provider TEXT DEFAULT NULL,
  p_tracking_number TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_tax_basis TEXT DEFAULT 'exclusive',
  p_gift_wrapping_fee NUMERIC DEFAULT 0,
  p_expected_total NUMERIC DEFAULT NULL,
  p_checkout_idempotency_key TEXT DEFAULT NULL,
  p_checkout_request_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  order_number TEXT,
  tracking_token TEXT,
  subtotal NUMERIC,
  shipping_fee NUMERIC,
  discount_amount NUMERIC,
  tax_amount NUMERIC,
  total NUMERIC,
  customer_id UUID,
  customer_email TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  payment_status TEXT,
  shipping_status TEXT,
  payment_method TEXT,
  shipping_address JSONB,
  merchant_id UUID,
  tax_basis TEXT,
  gift_wrapping_fee NUMERIC,
  idempotency_replayed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    voucher_award_id text
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
    variant_stock, condition_offer_id, condition_valid, submitted_price, voucher_award_id
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
    r.submitted_price,r.voucher_award_id
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
    AND coalesce(v.is_active,true) AND v.status='active' AND v.deleted_at IS NULL AND v.archived_at IS NULL
    AND NOT coalesce((to_jsonb(v)->>'is_inventory_anchor')::boolean,false)
  LEFT JOIN public.product_offers offer ON r.variant_id IS NULL AND r.condition IS NOT NULL
    AND offer.product_id=p.id AND offer.merchant_id=p_merchant_id AND offer.condition=r.condition;

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
      IF stock_rec.manage_stock THEN
        UPDATE public.product_offers offer SET stock_quantity=offer.stock_quantity-stock_rec.total_quantity
        WHERE offer.id=stock_rec.condition_offer_id AND offer.merchant_id=p_merchant_id AND offer.product_id=stock_rec.product_id
          AND offer.status='active' AND offer.stock_quantity>=stock_rec.total_quantity;
        IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_condition_offer_stock'; END IF;
      END IF;
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
    product_offer_id
  )
  SELECT
    v_order_id,
    t.product_id,
    t.condition,
    t.image_url,
    t.variant_id,
    t.variant_name,
    t.product_name,
    COALESCE(t.price_override, t.base_price),
    t.quantity,
    t.has_assurance,
    t.assurance_fee,
    COALESCE(t.variant_attributes, '{}'::jsonb),
    t.condition_offer_id
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
$$;
CREATE OR REPLACE FUNCTION public.commerce_cart_build_checkout_snapshot(
  p_merchant_id uuid, p_cart_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_cart public.commerce_carts%ROWTYPE;
  v_lines jsonb;
  v_subtotal bigint;
  v_unavailable integer;
BEGIN
  SELECT * INTO v_cart
  FROM public.commerce_carts
  WHERE id = p_cart_id AND merchant_id = p_merchant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  WITH line_checks AS (
    SELECT
      l.id AS line_id,
      l.created_at AS line_created,
      l.product_id AS product_id,
      l.variant_id AS variant_id,
      l.condition AS condition,
      l.options AS options,
      l.quantity AS quantity,
      l.negotiated_unit_price_minor AS negotiated,
      l.negotiation_status AS neg_status,
      l.voucher_token AS voucher_token,
      l.voucher_award_id AS voucher_award_id,
      l.has_assurance AS has_assurance,
      l.assurance_rate AS assurance_rate,
      l.last_unit_price_minor AS last_price,
      (
        p.id IS NOT NULL
        AND p.merchant_id = p_merchant_id
        AND p.status = 'active'
        AND (
          l.variant_id IS NULL
          OR (
            v.id IS NOT NULL
            AND v.product_id = l.product_id
            AND v.merchant_id = p_merchant_id
            -- Match the storefront public-variant predicate: a variant
            -- deactivated, archived or soft-deleted after being added
            -- is no longer reviewed as available, and the inventory
            -- anchor is not purchasable when the product has variants.
            AND coalesce(v.is_active, true)
            AND v.status = 'active'
            AND v.deleted_at IS NULL
            AND v.archived_at IS NULL
            AND NOT coalesce((to_jsonb(v)->>'is_inventory_anchor')::boolean,false)
            AND NOT (coalesce(p.has_variants, false) AND coalesce(v.is_default, false))
          )
        )
      ) AND public.commerce_cart_condition_supported(p_merchant_id,l.product_id,l.variant_id,l.condition) AS offer_ok,
      (round(coalesce(v.price_override, offer.price, p.price, 0) * 100))::bigint AS catalog_minor,
      offer.id AS condition_offer_id,
      CASE
        WHEN offer.id IS NOT NULL THEN greatest(offer.stock_quantity,0)
        WHEN policy.value IN ('serialized_strict','serialized_then_unlimited') THEN coalesce(units.public_available_units,0)
        WHEN l.variant_id IS NULL THEN
          CASE
            WHEN p.stock_quantity IS NULL THEN greatest(coalesce(p.stock, 0), 0)
            WHEN p.stock_quantity = 0 AND coalesce(p.stock, 0) > 0 THEN p.stock
            ELSE greatest(p.stock_quantity, 0)
          END
        ELSE greatest(coalesce(v.stock_quantity, 0), 0)
      END AS stock_qty,
      CASE WHEN offer.id IS NOT NULL THEN coalesce(p.manage_stock,true) WHEN policy.value='serialized_then_unlimited' THEN false WHEN policy.value='serialized_strict' THEN true ELSE coalesce(p.manage_stock,true) END AS manage_stock
    FROM public.commerce_cart_lines l
    LEFT JOIN public.products p ON p.id = l.product_id
    LEFT JOIN public.product_variants v ON v.id = l.variant_id
    LEFT JOIN public.product_offers offer ON l.variant_id IS NULL AND l.condition IS NOT NULL AND offer.product_id=l.product_id AND offer.merchant_id=p_merchant_id AND offer.condition=l.condition AND offer.status='active'
    CROSS JOIN LATERAL (SELECT CASE WHEN to_jsonb(v)->>'inventory_tracking_policy' IN ('off','serialized_strict','serialized_then_unlimited') THEN to_jsonb(v)->>'inventory_tracking_policy' ELSE coalesce(to_jsonb(p)->>'inventory_tracking_policy','off') END AS value) policy
    LEFT JOIN LATERAL (SELECT counts.public_available_units FROM public.get_public_serialized_variant_availability_counts(p_merchant_id,ARRAY[l.product_id],NULL) counts WHERE counts.product_id=l.product_id AND counts.variant_id IS NOT DISTINCT FROM l.variant_id) units ON true
    WHERE l.merchant_id = p_merchant_id AND l.cart_id = p_cart_id
  ),
  enriched AS (
    SELECT
      line_id,
      line_created,
      product_id,
      variant_id,
      condition,
      options,
      quantity,
      negotiated,
      neg_status,
      voucher_token,
      voucher_award_id,
      has_assurance,
      assurance_rate,
      last_price,
      offer_ok,
      stock_qty,
      manage_stock,
      CASE WHEN offer_ok THEN catalog_minor ELSE coalesce(last_price, 0) END AS validated,
      (
        negotiated IS NOT NULL
        AND (
          NOT offer_ok
          OR negotiated <= 0
          OR negotiated >= catalog_minor
          OR NOT public.commerce_cart_product_negotiable(p_merchant_id,product_id) OR (catalog_minor-negotiated)::numeric*100>catalog_minor::numeric*2
        )
      ) AS neg_invalid,
      (voucher_token IS NOT NULL OR voucher_award_id IS NOT NULL) AS has_voucher,
      -- The order function validates and decrements stock per
      -- (product, variant) pool with summed quantities, so availability
      -- must judge the pooled demand too: attachment-distinct lines of
      -- one product share the pool even though they never merge.
      sum(CASE WHEN voucher_token IS NOT NULL OR voucher_award_id IS NOT NULL THEN 0 ELSE quantity END) OVER (PARTITION BY product_id, variant_id, condition_offer_id) AS pool_demand
    FROM line_checks
  )
  SELECT
    coalesce(jsonb_agg(line ORDER BY line_created, line_id), '[]'::jsonb),
    coalesce(sum(effective::bigint * quantity), 0),
    coalesce(sum(CASE WHEN available THEN 0 ELSE 1 END), 0)
  INTO v_lines, v_subtotal, v_unavailable
  FROM (
    SELECT
      line_created,
      line_id,
      quantity,
      CASE
        WHEN has_voucher THEN 0
        WHEN negotiated IS NOT NULL AND neg_status = 'accepted' AND NOT neg_invalid
        THEN negotiated
        ELSE validated
      END AS effective,
      (
        offer_ok
        AND (has_voucher OR NOT manage_stock OR stock_qty >= pool_demand)
      ) AS available,
      jsonb_build_object(
        'id', line_id,
        'productId', product_id,
        'variantId', variant_id,
        'condition', condition,
        'options', coalesce(options, '{}'::jsonb),
        'quantity', quantity,
        'negotiatedUnitPriceMinor', negotiated,
        'negotiationStatus', neg_status,
        'negotiationInvalidated', neg_invalid,
        'voucherToken', voucher_token,
        'voucherAwardId', voucher_award_id,
        'hasAssurance', has_assurance,
        'assuranceRate', assurance_rate,
        'lastUnitPriceMinor', last_price,
        'validatedUnitPriceMinor', validated,
        'effectiveUnitPriceMinor',
          CASE
            WHEN has_voucher THEN 0
            WHEN negotiated IS NOT NULL AND neg_status = 'accepted' AND NOT neg_invalid
            THEN negotiated
            ELSE validated
          END,
        'priceChanged', validated IS DISTINCT FROM last_price,
        'available', offer_ok AND (has_voucher OR NOT manage_stock OR stock_qty >= pool_demand),
        'unavailableReason',
          CASE
            WHEN NOT offer_ok THEN 'offer_invalid'
            WHEN NOT has_voucher AND manage_stock AND stock_qty <= 0 THEN 'out_of_stock'
            WHEN NOT has_voucher AND manage_stock AND stock_qty < pool_demand THEN 'insufficient_stock'
            ELSE NULL
          END,
        'stockQty', stock_qty,
        'manageStock', manage_stock
      ) AS line
    FROM enriched
  ) s;

  RETURN jsonb_build_object(
    'lines', v_lines,
    'estimates', jsonb_build_object(
      'subtotalMinor', v_subtotal,
      'currency', v_cart.currency,
      'lineCount', jsonb_array_length(v_lines),
      'unavailableCount', v_unavailable
    )
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.commerce_cart_assemble_state(
  p_merchant_id uuid, p_cart_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_cart public.commerce_carts%ROWTYPE;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_cart
  FROM public.commerce_carts
  WHERE id = p_cart_id AND merchant_id = p_merchant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(line ORDER BY line_created, line_id), '[]'::jsonb)
  INTO v_lines
  FROM (
    SELECT
      l.id AS line_id,
      l.created_at AS line_created,
      jsonb_build_object(
        'id', l.id,
        'productId', l.product_id,
        'variantId', l.variant_id,
        'condition', l.condition,
        'options', coalesce(l.options, '{}'::jsonb),
        'quantity', l.quantity,
        'negotiatedUnitPriceMinor', l.negotiated_unit_price_minor,
        'negotiationStatus', l.negotiation_status,
        'negotiationInvalidated',
          l.negotiated_unit_price_minor IS NOT NULL
          AND (
            NOT (
              p.id IS NOT NULL
              AND p.merchant_id = p_merchant_id
              AND p.status = 'active'
              AND (
                l.variant_id IS NULL
                OR (
                  v.id IS NOT NULL
                  AND v.product_id = l.product_id
                  AND v.merchant_id = p_merchant_id
                )
              )
            )
            OR l.negotiated_unit_price_minor <= 0
            OR l.negotiated_unit_price_minor >= (
              SELECT public.commerce_cart_offer_price_minor(p_merchant_id,l.product_id,l.variant_id,l.condition)
              FROM public.products p2
              LEFT JOIN public.product_variants v2 ON v2.id = l.variant_id
              WHERE p2.id = l.product_id
            )
          ),
        'voucherToken', l.voucher_token,
        'voucherAwardId', l.voucher_award_id,
        'hasAssurance', l.has_assurance,
        'assuranceRate', l.assurance_rate,
        'unitPriceMinor',
          CASE
            WHEN p.id IS NOT NULL
              AND p.merchant_id = p_merchant_id
              AND p.status = 'active'
              AND (
                l.variant_id IS NULL
                OR (
                  v.id IS NOT NULL
                  AND v.product_id = l.product_id
                  AND v.merchant_id = p_merchant_id
                )
              )
            THEN public.commerce_cart_offer_price_minor(p_merchant_id,l.product_id,l.variant_id,l.condition)
            ELSE coalesce(l.last_unit_price_minor, 0)
          END,
        'available',
          p.id IS NOT NULL
          AND p.merchant_id = p_merchant_id
          AND p.status = 'active'
          AND public.commerce_cart_condition_supported(p_merchant_id,l.product_id,l.variant_id,l.condition)
          AND (
            l.variant_id IS NULL
            OR (
              v.id IS NOT NULL
              AND v.product_id = l.product_id
              AND v.merchant_id = p_merchant_id
            )
          ),
        'stockQty',
          CASE
            WHEN p.stock_quantity IS NULL THEN greatest(coalesce(p.stock, 0), 0)
            WHEN p.stock_quantity = 0 AND coalesce(p.stock, 0) > 0 THEN p.stock
            ELSE greatest(p.stock_quantity, 0)
          END,
        'manageStock', coalesce(p.manage_stock, true)
      ) AS line
    FROM public.commerce_cart_lines l
    LEFT JOIN public.products p ON p.id = l.product_id
    LEFT JOIN public.product_variants v ON v.id = l.variant_id
    WHERE l.merchant_id = p_merchant_id AND l.cart_id = p_cart_id
  ) s;

  RETURN jsonb_build_object(
    'cartId', v_cart.id,
    'merchantId', v_cart.merchant_id,
    'state', v_cart.state,
    'version', v_cart.version,
    'lines', v_lines,
    'currency', v_cart.currency,
    'expiresAt', to_char(v_cart.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'checkoutSessionId', v_cart.checkout_session_id,
    'replayed', false
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.commerce_cart_mutate_authorized_impl(
  p_cart_id uuid, p_operation_id text, p_expected_version integer, p_command jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_grant uuid;
  v_digest text;
  v_existing public.commerce_cart_operations%ROWTYPE;
  v_cart public.commerce_carts%ROWTYPE;
  v_grant_live boolean;
  v_grant_known boolean;
  v_state jsonb;
  v_type text;
  v_changed boolean := false;
  v_product_id uuid;
  v_variant_id uuid;
  v_condition text;
  v_options jsonb;
  v_quantity integer;
  v_voucher_token text;
  v_voucher_award text;
  v_negotiated bigint;
  v_neg_status text;
  v_line_id uuid;
  v_line public.commerce_cart_lines%ROWTYPE;
  v_entry jsonb;
  v_count integer;
  v_new_version integer;
BEGIN
  IF nullif(v_claims ->> 'cart_merchant_id', '') IS NULL
    OR (v_claims ->> 'cart_merchant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(v_claims ->> 'cart_principal_id', '') IS NULL
    OR (v_claims ->> 'cart_scope') <> 'session'
    OR nullif(v_claims ->> 'cart_id', '') IS NULL
    OR (v_claims ->> 'cart_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR (v_claims ->> 'cart_id')::uuid <> p_cart_id
    OR nullif(v_claims ->> 'cart_grant_id', '') IS NULL
    OR (v_claims ->> 'cart_grant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  v_merchant := (v_claims ->> 'cart_merchant_id')::uuid;
  v_principal := v_claims ->> 'cart_principal_id';
  v_grant := (v_claims ->> 'cart_grant_id')::uuid;

  -- Pilot gate (defense in depth with the route-level check): the
  -- shared-cart RPCs refuse merchants without the shared_cart feature,
  -- mirroring the broadcast/account predicates.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_merchant AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'merchant_unavailable', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  IF p_operation_id IS NULL OR length(trim(p_operation_id)) = 0 OR length(p_operation_id) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-op|' || v_merchant::text || '|' || p_cart_id::text || '|' || v_principal || '|' || p_operation_id, 0)
  );

  SELECT EXISTS (
    SELECT 1 FROM public.commerce_cart_grants g
    WHERE g.id = v_grant AND g.merchant_id = v_merchant AND g.cart_id = p_cart_id
      AND g.principal_id = v_principal AND g.expires_at > now() AND g.revoked_at IS NULL
  ) INTO v_grant_live;
  IF NOT coalesce(v_grant_live, false) THEN
    SELECT EXISTS (SELECT 1 FROM public.commerce_cart_grants g WHERE g.id = v_grant) INTO v_grant_known;
    IF coalesce(v_grant_known, false) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  v_digest := pg_catalog.md5(p_command::text);
  SELECT * INTO v_existing
  FROM public.commerce_cart_operations
  WHERE merchant_id = v_merchant AND cart_id = p_cart_id
    AND principal_id = v_principal AND operation_id = p_operation_id;
  IF FOUND THEN
    SELECT version INTO v_new_version FROM public.commerce_carts WHERE id = p_cart_id;
    IF v_existing.request_digest <> v_digest OR v_existing.result IS NULL THEN
      SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'replayed', false,
        'state', v_state, 'currentVersion', v_new_version);
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', true,
      'state', v_existing.result, 'currentVersion', v_new_version);
  END IF;

  SELECT * INTO v_cart
  FROM public.commerce_carts
  WHERE id = p_cart_id AND merchant_id = v_merchant
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF v_cart.state <> 'active' THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'cart_locked', 'replayed', false,
      'state', v_state, 'currentVersion', v_cart.version);
  END IF;
  IF v_cart.version <> p_expected_version THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'version_conflict', 'replayed', false,
      'state', v_state, 'currentVersion', v_cart.version);
  END IF;

  IF jsonb_typeof(p_command) <> 'object' THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  v_type := p_command ->> 'type';

  IF v_type = 'add' THEN
    SELECT pi_product, pi_variant, pi_condition, pi_options, pi_quantity,
      pi_voucher_token, pi_voucher_award, pi_negotiated, pi_neg_status
    INTO v_product_id, v_variant_id, v_condition, v_options, v_quantity,
      v_voucher_token, v_voucher_award, v_negotiated, v_neg_status
    FROM public.commerce_cart_parse_input_line(p_command);
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
    SELECT * INTO v_line
    FROM public.commerce_cart_lines
    WHERE merchant_id = v_merchant AND cart_id = p_cart_id
      AND product_id = v_product_id
      AND variant_id IS NOT DISTINCT FROM v_variant_id
      AND condition IS NOT DISTINCT FROM v_condition
      AND options = v_options
      AND voucher_token IS NOT DISTINCT FROM v_voucher_token
      AND voucher_award_id IS NOT DISTINCT FROM v_voucher_award::uuid;
    IF FOUND THEN
      IF v_line.voucher_token IS NOT NULL OR v_line.voucher_award_id IS NOT NULL THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
      IF v_line.quantity + v_quantity > 10 THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.commerce_cart_lines
      SET quantity = quantity + v_quantity,
        last_unit_price_minor = public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id, v_condition),
        updated_at = now()
      WHERE id = v_line.id;
    ELSE
      SELECT count(*) INTO v_count
      FROM public.commerce_cart_lines
      WHERE merchant_id = v_merchant AND cart_id = p_cart_id;
      IF v_count >= 20 THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.commerce_cart_lines (
        merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
        negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
        last_unit_price_minor, has_assurance, assurance_rate
      ) VALUES (
        v_merchant, p_cart_id, v_product_id, v_variant_id, v_condition, v_options,
        CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status),
        v_voucher_token, v_voucher_award::uuid,
        public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id, v_condition), coalesce((p_command->>'hasAssurance')::boolean,false), CASE WHEN coalesce((p_command->>'hasAssurance')::boolean,false) THEN 0.05 ELSE NULL END
      );
    END IF;
    v_changed := true;

  ELSIF v_type = 'set_quantity' THEN
    IF (p_command ->> 'lineId') IS NULL
      OR (p_command ->> 'lineId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR (p_command ->> 'quantity') IS NULL
      OR (p_command ->> 'quantity') !~ '^[0-9]+$'
      OR (p_command ->> 'quantity')::integer < 1
      OR (p_command ->> 'quantity')::integer > 10 THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_line_id := (p_command ->> 'lineId')::uuid;
    v_quantity := (p_command ->> 'quantity')::integer;
    SELECT * INTO v_line
    FROM public.commerce_cart_lines
    WHERE id = v_line_id AND merchant_id = v_merchant AND cart_id = p_cart_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    -- Voucher-backed lines are pinned to quantity one at creation and
    -- import; quantity controls must never unpin them, or the orders
    -- route would reject the cart at checkout.
    IF (v_line.voucher_token IS NOT NULL OR v_line.voucher_award_id IS NOT NULL)
      AND v_quantity <> 1 THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    IF v_quantity = v_line.quantity THEN
      v_changed := false;
    ELSE
      IF v_quantity > v_line.quantity THEN
        PERFORM public.commerce_cart_require_offer(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition);
      END IF;
      UPDATE public.commerce_cart_lines
      SET quantity = v_quantity,
        last_unit_price_minor = CASE WHEN v_quantity > v_line.quantity THEN public.commerce_cart_offer_price_minor(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition) ELSE v_line.last_unit_price_minor END,
        updated_at = now()
      WHERE id = v_line.id;
      v_changed := true;
    END IF;

  ELSIF v_type = 'remove' THEN
    IF (p_command ->> 'lineId') IS NULL
      OR (p_command ->> 'lineId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_line_id := (p_command ->> 'lineId')::uuid;
    DELETE FROM public.commerce_cart_lines
    WHERE id = v_line_id AND merchant_id = v_merchant AND cart_id = p_cart_id;
    v_changed := FOUND;

  ELSIF v_type = 'clear' THEN
    DELETE FROM public.commerce_cart_lines
    WHERE merchant_id = v_merchant AND cart_id = p_cart_id;
    v_changed := FOUND;

  ELSIF v_type = 'set_assurance' THEN
    IF (p_command ->> 'lineId') IS NULL
      OR (p_command ->> 'lineId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR (p_command ->> 'hasAssurance') NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_line_id := (p_command ->> 'lineId')::uuid;
    SELECT * INTO v_line
    FROM public.commerce_cart_lines
    WHERE id = v_line_id AND merchant_id = v_merchant AND cart_id = p_cart_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    IF (p_command ->> 'hasAssurance')::boolean = v_line.has_assurance THEN
      v_changed := false;
    ELSE
      -- The coverage rate is server-owned; shoppers choose coverage only.
      UPDATE public.commerce_cart_lines
      SET has_assurance = (p_command ->> 'hasAssurance')::boolean,
        assurance_rate = CASE
          WHEN (p_command ->> 'hasAssurance')::boolean THEN 0.05
          ELSE NULL
        END,
        updated_at = now()
      WHERE id = v_line.id;
      v_changed := true;
    END IF;

  ELSIF v_type = 'set_negotiated_price' THEN
    IF (p_command ->> 'lineId') IS NULL
      OR (p_command ->> 'lineId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR ((p_command ->> 'negotiatedUnitPriceMinor') IS NOT NULL
        AND (p_command ->> 'negotiatedUnitPriceMinor') !~ '^[0-9]+$') THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_line_id := (p_command ->> 'lineId')::uuid;
    SELECT * INTO v_line
    FROM public.commerce_cart_lines
    WHERE id = v_line_id AND merchant_id = v_merchant AND cart_id = p_cart_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_negotiated := (p_command ->> 'negotiatedUnitPriceMinor')::bigint;
    IF v_negotiated IS NOT NULL THEN
      -- A negotiated price is a live-offer discount in place: the line,
      -- its quantity and its identity never move, so a failed or
      -- interrupted reprice cannot lose the item.
      PERFORM public.commerce_cart_require_offer(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition);
      IF v_negotiated < 1
        OR v_negotiated >= public.commerce_cart_offer_price_minor(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition) THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_negotiated IS NOT DISTINCT FROM v_line.negotiated_unit_price_minor THEN
      v_changed := false;
    ELSE
      UPDATE public.commerce_cart_lines
      SET negotiated_unit_price_minor = v_negotiated,
        negotiation_status = CASE WHEN v_negotiated IS NULL THEN NULL
        ELSE public.commerce_cart_negotiation_status(v_merchant,v_line.product_id,v_line.variant_id,v_line.condition,v_negotiated,NULL) END,
        updated_at = now()
      WHERE id = v_line.id;
      v_changed := true;
    END IF;

  ELSIF v_type = 'replace' THEN
    IF jsonb_typeof(p_command -> 'lines') <> 'array'
      OR jsonb_array_length(p_command -> 'lines') > 20 THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'cart_replace_want' AND n.nspname LIKE 'pg_temp%'
    ) THEN
      DROP TABLE cart_replace_want;
    END IF;
    CREATE TEMPORARY TABLE cart_replace_want (
      product_id uuid, variant_id uuid, condition text, options jsonb,
      quantity integer, voucher_token text, voucher_award uuid,
      negotiated bigint, neg_status text, assurance boolean
    ) ON COMMIT DROP;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_command -> 'lines') value LOOP
      SELECT pi_product, pi_variant, pi_condition, pi_options, pi_quantity,
        pi_voucher_token, pi_voucher_award, pi_negotiated, pi_neg_status
      INTO v_product_id, v_variant_id, v_condition, v_options, v_quantity,
        v_voucher_token, v_voucher_award, v_negotiated, v_neg_status
      FROM public.commerce_cart_parse_input_line(v_entry);
      IF v_product_id IS NULL THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
      PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
      IF EXISTS (
        SELECT 1 FROM cart_replace_want w
        WHERE w.product_id = v_product_id
          AND w.variant_id IS NOT DISTINCT FROM v_variant_id
          AND w.condition IS NOT DISTINCT FROM v_condition
          AND w.options = v_options
          AND w.voucher_token IS NOT DISTINCT FROM v_voucher_token
          AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid
      ) THEN
        IF v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN
          RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
        END IF;
        UPDATE cart_replace_want w
        SET quantity = w.quantity + v_quantity, assurance=w.assurance OR coalesce((v_entry->>'hasAssurance')::boolean,false)
        WHERE w.product_id = v_product_id
          AND w.variant_id IS NOT DISTINCT FROM v_variant_id
          AND w.condition IS NOT DISTINCT FROM v_condition
          AND w.options = v_options
          AND w.voucher_token IS NOT DISTINCT FROM v_voucher_token
          AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid;
        IF EXISTS (SELECT 1 FROM cart_replace_want w WHERE w.quantity > 10) THEN
          RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
        END IF;
      ELSE
        INSERT INTO cart_replace_want VALUES (
          v_product_id, v_variant_id, v_condition, v_options,
          CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
          v_voucher_token, v_voucher_award::uuid, v_negotiated,
          public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status), coalesce((v_entry->>'hasAssurance')::boolean,false)
        );
      END IF;
    END LOOP;
    -- Delete lines with no matching wanted identity; update matched ones.
    DELETE FROM public.commerce_cart_lines l
    WHERE l.merchant_id = v_merchant AND l.cart_id = p_cart_id
      AND NOT EXISTS (
        SELECT 1 FROM cart_replace_want w
        WHERE w.product_id = l.product_id
          AND w.variant_id IS NOT DISTINCT FROM l.variant_id
          AND w.condition IS NOT DISTINCT FROM l.condition
          AND w.options = l.options
          AND w.voucher_token IS NOT DISTINCT FROM l.voucher_token
          AND w.voucher_award IS NOT DISTINCT FROM l.voucher_award_id
      );
    IF FOUND THEN v_changed := true; END IF;
    UPDATE public.commerce_cart_lines l
    SET quantity = w.quantity, has_assurance=w.assurance, assurance_rate=CASE WHEN w.assurance THEN 0.05 ELSE NULL END,
      negotiated_unit_price_minor = w.negotiated,
      negotiation_status = w.neg_status,
      last_unit_price_minor = public.commerce_cart_offer_price_minor(v_merchant, l.product_id, l.variant_id, l.condition),
      updated_at = now()
    FROM cart_replace_want w
    WHERE l.merchant_id = v_merchant AND l.cart_id = p_cart_id
      AND w.product_id = l.product_id
      AND w.variant_id IS NOT DISTINCT FROM l.variant_id
      AND w.condition IS NOT DISTINCT FROM l.condition
      AND w.options = l.options
      AND w.voucher_token IS NOT DISTINCT FROM l.voucher_token
      AND w.voucher_award IS NOT DISTINCT FROM l.voucher_award_id
      AND (
        l.quantity IS DISTINCT FROM w.quantity
        OR l.negotiated_unit_price_minor IS DISTINCT FROM w.negotiated
        OR l.has_assurance IS DISTINCT FROM w.assurance
        OR l.negotiation_status IS DISTINCT FROM w.neg_status
      );
    IF FOUND THEN v_changed := true; END IF;
    INSERT INTO public.commerce_cart_lines (
      merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
      negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
      last_unit_price_minor, has_assurance, assurance_rate
    )
    SELECT v_merchant, p_cart_id, w.product_id, w.variant_id, w.condition, w.options,
      w.quantity, w.negotiated, w.neg_status, w.voucher_token, w.voucher_award,
      public.commerce_cart_offer_price_minor(v_merchant, w.product_id, w.variant_id, w.condition), w.assurance, CASE WHEN w.assurance THEN 0.05 ELSE NULL END
    FROM cart_replace_want w
    WHERE NOT EXISTS (
      SELECT 1 FROM public.commerce_cart_lines l
      WHERE l.merchant_id = v_merchant AND l.cart_id = p_cart_id
        AND w.product_id = l.product_id
        AND w.variant_id IS NOT DISTINCT FROM l.variant_id
        AND w.condition IS NOT DISTINCT FROM l.condition
        AND w.options = l.options
        AND w.voucher_token IS NOT DISTINCT FROM l.voucher_token
        AND w.voucher_award IS NOT DISTINCT FROM l.voucher_award_id
    );
    IF FOUND THEN v_changed := true; END IF;
    DROP TABLE cart_replace_want;

  ELSE
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;

  IF v_changed THEN
    -- Sliding renewal is capped at the absolute 7-day lifetime from
    -- creation, matching checkout preparation: mutations must not keep
    -- a guest cart (and its stored voucher credentials) alive forever.
    UPDATE public.commerce_carts
    SET version = version + 1, updated_at = now(),
      expires_at = greatest(expires_at, now() + interval '7 days')
    WHERE id = p_cart_id;
    UPDATE public.commerce_cart_grants
    SET expires_at = greatest(expires_at, now() + interval '7 days')
    WHERE id = v_grant AND merchant_id = v_merchant AND cart_id = p_cart_id
      AND principal_id = v_principal AND revoked_at IS NULL;
    SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
    v_new_version := (v_state ->> 'version')::integer;
    INSERT INTO public.commerce_cart_events
      (merchant_id, cart_id, version, operation_id, payload, expires_at)
    VALUES (
      v_merchant, p_cart_id, v_new_version, p_operation_id,
      jsonb_build_object(
        'cartId', p_cart_id, 'version', v_new_version, 'operationId', p_operation_id
      ),
      now() + interval '7 days'
    );
  ELSE
    SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
    v_new_version := (v_state ->> 'version')::integer;
  END IF;

  INSERT INTO public.commerce_cart_operations
    (merchant_id, cart_id, principal_id, operation_id, request_digest, result, expires_at)
  VALUES (v_merchant, p_cart_id, v_principal, p_operation_id, v_digest, v_state, now() + interval '7 days');

  RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false,
    'state', v_state, 'currentVersion', v_new_version);
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'invalid_line' OR SQLERRM = 'invalid_offer' THEN
      SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
      SELECT version INTO v_new_version FROM public.commerce_carts WHERE id = p_cart_id;
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false,
        'state', v_state, 'currentVersion', v_new_version);
    END IF;
    RAISE;
END;
$$;
CREATE OR REPLACE FUNCTION public.commerce_cart_create_device_impl(
  p_operation_id text, p_lines jsonb, p_currency text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_digest text;
  v_existing public.commerce_cart_creation_requests%ROWTYPE;
  v_cart_id uuid;
  v_grant_id uuid;
  v_state jsonb;
  v_line jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_condition text;
  v_options jsonb;
  v_quantity integer;
  v_voucher_token text;
  v_voucher_award text;
  v_negotiated bigint;
  v_neg_status text;
  v_line_count integer;
  v_staged public.commerce_cart_lines%ROWTYPE;
BEGIN
  IF nullif(v_claims ->> 'cart_merchant_id', '') IS NULL
    OR (v_claims ->> 'cart_merchant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(v_claims ->> 'cart_principal_id', '') IS NULL
    OR (v_claims ->> 'cart_scope') <> 'bootstrap'
    OR (v_claims ->> 'cart_id') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  v_merchant := (v_claims ->> 'cart_merchant_id')::uuid;
  v_principal := v_claims ->> 'cart_principal_id';

  -- Pilot gate (defense in depth with the route-level check): the
  -- shared-cart RPCs refuse merchants without the shared_cart feature,
  -- mirroring the broadcast/account predicates.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_merchant AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'merchant_unavailable', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  IF p_operation_id IS NULL OR length(trim(p_operation_id)) = 0 OR length(p_operation_id) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  SELECT public.commerce_cart_resolve_merchant_currency(to_jsonb(m)->>'payout_currency',to_jsonb(m)->>'country') INTO p_currency FROM public.merchants m WHERE m.id=v_merchant;
  IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-create|' || v_merchant::text || '|' || v_principal || '|' || p_operation_id, 0)
  );

  v_digest := pg_catalog.md5(p_lines::text || '|' || p_currency);
  SELECT * INTO v_existing
  FROM public.commerce_cart_creation_requests
  WHERE merchant_id = v_merchant AND principal_id = v_principal AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.request_digest <> v_digest THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    IF v_existing.result IS NULL OR v_existing.cart_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    SELECT public.commerce_cart_assemble_state(v_merchant, v_existing.cart_id) INTO v_state;
    IF v_state IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', true, 'state', v_state,
      'currentVersion', (v_state ->> 'version')::integer, 'grantId', v_existing.grant_id);
  END IF;

  v_cart_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at)
  VALUES (v_cart_id, v_merchant, p_currency, 1, 'active', now() + interval '7 days');

  v_grant_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, principal_type, expires_at)
  VALUES (v_grant_id, v_merchant, v_cart_id, v_principal, 'guest', now() + interval '7 days');

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) value LOOP
    SELECT pi_product, pi_variant, pi_condition, pi_options, pi_quantity,
      pi_voucher_token, pi_voucher_award, pi_negotiated, pi_neg_status
    INTO v_product_id, v_variant_id, v_condition, v_options, v_quantity,
      v_voucher_token, v_voucher_award, v_negotiated, v_neg_status
    FROM public.commerce_cart_parse_input_line(v_line);
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
    -- Repeated identities merge exactly like `add`: one logical line,
    -- summed quantity within the per-line cap; voucher lines never merge.
    SELECT * INTO v_staged
    FROM public.commerce_cart_lines
    WHERE merchant_id = v_merchant AND cart_id = v_cart_id
      AND product_id = v_product_id
      AND variant_id IS NOT DISTINCT FROM v_variant_id
      AND condition IS NOT DISTINCT FROM v_condition
      AND options = v_options
      AND voucher_token IS NOT DISTINCT FROM v_voucher_token
      AND voucher_award_id IS NOT DISTINCT FROM
        (CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END);
    IF FOUND THEN
      IF v_staged.voucher_token IS NOT NULL OR v_staged.voucher_award_id IS NOT NULL
        OR v_staged.quantity + v_quantity > 10 THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.commerce_cart_lines
      SET quantity = quantity + v_quantity, has_assurance=has_assurance OR coalesce((v_line->>'hasAssurance')::boolean,false), assurance_rate=CASE WHEN has_assurance OR coalesce((v_line->>'hasAssurance')::boolean,false) THEN 0.05 ELSE NULL END, updated_at = now()
      WHERE id = v_staged.id;
    ELSE
      INSERT INTO public.commerce_cart_lines (
        merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
        negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
        last_unit_price_minor, has_assurance, assurance_rate
      ) VALUES (
        v_merchant, v_cart_id, v_product_id, v_variant_id, v_condition, v_options,
        CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status),
        v_voucher_token, CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END,
        public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id, v_condition), coalesce((v_line->>'hasAssurance')::boolean,false), CASE WHEN coalesce((v_line->>'hasAssurance')::boolean,false) THEN 0.05 ELSE NULL END
      );
    END IF;
  END LOOP;

  SELECT public.commerce_cart_assemble_state(v_merchant, v_cart_id) INTO v_state;
  INSERT INTO public.commerce_cart_creation_requests
    (merchant_id, principal_id, operation_id, request_digest, cart_id, grant_id, result, expires_at)
  VALUES (v_merchant, v_principal, p_operation_id, v_digest, v_cart_id, v_grant_id, v_state, now() + interval '7 days');

  RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false, 'state', v_state, 'currentVersion', 1, 'grantId', v_grant_id);
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'invalid_line' OR SQLERRM = 'invalid_offer' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RAISE;
END;
$$;
CREATE OR REPLACE FUNCTION public.commerce_cart_migrate_legacy_owner_impl(
  p_provider text, p_legacy_token_hash text, p_operation_id text,
  p_lines jsonb, p_legacy_version text, p_currency text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_digest text;
  v_ref public.commerce_cart_legacy_refs%ROWTYPE;
  v_cart_id uuid;
  v_grant_id uuid;
  v_state jsonb;
  v_line jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_condition text;
  v_options jsonb;
  v_quantity integer;
  v_voucher_token text;
  v_voucher_award text;
  v_negotiated bigint;
  v_neg_status text;
  v_grant_live boolean;
  v_grant_known boolean;
  v_other_cart uuid;
  v_legacy_version_int bigint;
  v_legacy_updated timestamptz;
BEGIN
  IF nullif(v_claims ->> 'cart_merchant_id', '') IS NULL
    OR (v_claims ->> 'cart_merchant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(v_claims ->> 'cart_principal_id', '') IS NULL
    OR (v_claims ->> 'cart_scope') <> 'bootstrap'
    OR (v_claims ->> 'cart_id') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  v_merchant := (v_claims ->> 'cart_merchant_id')::uuid;
  v_principal := v_claims ->> 'cart_principal_id';

  SELECT public.commerce_cart_resolve_merchant_currency(to_jsonb(m)->>'payout_currency',to_jsonb(m)->>'country') INTO p_currency FROM public.merchants m WHERE m.id=v_merchant;
  -- Pilot gate (defense in depth with the route-level check): the
  -- shared-cart RPCs refuse merchants without the shared_cart feature,
  -- mirroring the broadcast/account predicates.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_merchant AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'merchant_unavailable', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  IF p_provider NOT IN ('mcp', 'ucp')
    OR p_legacy_token_hash IS NULL
    OR p_legacy_token_hash !~ '^[a-f0-9]{64}$'
    OR p_operation_id IS NULL OR length(trim(p_operation_id)) = 0 OR length(p_operation_id) > 128
    OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
    OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) > 20
    OR p_legacy_version IS NULL OR length(trim(p_legacy_version)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-legacy|' || v_merchant::text || '|' || p_provider || '|' || p_legacy_token_hash, 0)
  );

  SELECT * INTO v_ref
  FROM public.commerce_cart_legacy_refs
  WHERE merchant_id = v_merchant AND provider = p_provider AND legacy_hash = p_legacy_token_hash;
  IF FOUND THEN
    SELECT EXISTS (
      SELECT 1 FROM public.commerce_cart_grants g
      WHERE g.cart_id = v_ref.cart_id AND g.merchant_id = v_merchant
        AND g.principal_id = v_principal AND g.expires_at > now() AND g.revoked_at IS NULL
    ) INTO v_grant_live;
    IF NOT coalesce(v_grant_live, false) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.commerce_cart_grants g
        WHERE g.cart_id = v_ref.cart_id AND g.principal_id = v_principal
      ) INTO v_grant_known;
      IF coalesce(v_grant_known, false) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    SELECT public.commerce_cart_assemble_state(v_merchant, v_ref.cart_id) INTO v_state;
    IF v_state IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', true, 'state', v_state,
      'currentVersion', (v_state ->> 'version')::integer);
  END IF;

  SELECT r.cart_id INTO v_other_cart
  FROM public.commerce_cart_legacy_refs r
  JOIN public.commerce_cart_grants g
    ON g.cart_id = r.cart_id AND g.merchant_id = r.merchant_id
  WHERE r.merchant_id = v_merchant
    AND g.principal_id = v_principal
    AND g.expires_at > now() AND g.revoked_at IS NULL
    AND (r.provider, r.legacy_hash) <> (p_provider, p_legacy_token_hash)
  LIMIT 1;
  IF v_other_cart IS NOT NULL THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, v_other_cart) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false,
      'state', v_state, 'currentVersion',
      CASE WHEN v_state IS NULL THEN NULL ELSE (v_state ->> 'version')::integer END);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'cart_migrate_want' AND n.nspname LIKE 'pg_temp%'
  ) THEN
    DROP TABLE cart_migrate_want;
  END IF;
  CREATE TEMPORARY TABLE cart_migrate_want (
    product_id uuid, variant_id uuid, condition text, options jsonb,
    quantity integer, voucher_token text, voucher_award uuid,
    negotiated bigint, neg_status text, assurance boolean
  ) ON COMMIT DROP;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) value LOOP
    SELECT pi_product, pi_variant, pi_condition, pi_options, pi_quantity,
      pi_voucher_token, pi_voucher_award, pi_negotiated, pi_neg_status
    INTO v_product_id, v_variant_id, v_condition, v_options, v_quantity,
      v_voucher_token, v_voucher_award, v_negotiated, v_neg_status
    FROM public.commerce_cart_parse_input_line(v_line);
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
    UPDATE cart_migrate_want w
    SET quantity = w.quantity + v_quantity, assurance=w.assurance OR coalesce((v_line->>'hasAssurance')::boolean,false)
    WHERE w.product_id = v_product_id
      AND w.variant_id IS NOT DISTINCT FROM v_variant_id
      AND w.condition IS NOT DISTINCT FROM v_condition
      AND w.options = v_options
      AND w.voucher_token IS NOT DISTINCT FROM v_voucher_token
      AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid;
    IF NOT FOUND THEN
      INSERT INTO cart_migrate_want VALUES (
        v_product_id, v_variant_id, v_condition, v_options, v_quantity,
        v_voucher_token, v_voucher_award::uuid, v_negotiated,
        public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status), coalesce((v_line->>'hasAssurance')::boolean,false)
      );
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM cart_migrate_want WHERE quantity > 10) THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_legacy_version_int FROM cart_migrate_want;
  IF v_legacy_version_int > 20 THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;

  v_cart_id := pg_catalog.gen_random_uuid();
  IF p_provider = 'mcp' THEN
    IF p_legacy_version !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.mcp_guest_carts
    SET migrated_to_cart_id = v_cart_id
    WHERE token_hash = p_legacy_token_hash
      AND migrated_to_cart_id IS NULL
      AND version = p_legacy_version::bigint;
    IF NOT FOUND THEN
      PERFORM 1 FROM public.mcp_guest_carts WHERE token_hash = p_legacy_token_hash;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
  ELSE
    BEGIN
      v_legacy_updated := p_legacy_version::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END;
    UPDATE public.agentic_cart_sessions
    SET migrated_to_cart_id = v_cart_id
    WHERE cart_id_hash = p_legacy_token_hash
      AND migrated_to_cart_id IS NULL
      AND updated_at = v_legacy_updated;
    IF NOT FOUND THEN
      PERFORM 1 FROM public.agentic_cart_sessions WHERE cart_id_hash = p_legacy_token_hash;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
  END IF;

  INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at)
  VALUES (v_cart_id, v_merchant, p_currency, 1, 'active', now() + interval '7 days');

  v_grant_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, principal_type, expires_at)
  VALUES (v_grant_id, v_merchant, v_cart_id, v_principal, 'guest', now() + interval '7 days');

  INSERT INTO public.commerce_cart_lines (
    merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
    negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
    last_unit_price_minor, has_assurance, assurance_rate
  )
  SELECT v_merchant, v_cart_id, w.product_id, w.variant_id, w.condition, w.options,
    CASE WHEN w.voucher_token IS NOT NULL OR w.voucher_award IS NOT NULL THEN 1 ELSE w.quantity END,
    w.negotiated, w.neg_status, w.voucher_token, w.voucher_award,
    public.commerce_cart_offer_price_minor(v_merchant, w.product_id, w.variant_id, w.condition), w.assurance, CASE WHEN w.assurance THEN 0.05 ELSE NULL END
  FROM cart_migrate_want w;
  DROP TABLE cart_migrate_want;

  v_digest := pg_catalog.md5(p_provider || '|' || p_legacy_token_hash || '|' || p_lines::text || '|' || p_currency);
  INSERT INTO public.commerce_cart_legacy_refs (merchant_id, provider, legacy_hash, cart_id, receipt)
  VALUES (v_merchant, p_provider, p_legacy_token_hash, v_cart_id,
    jsonb_build_object('operation_id', p_operation_id, 'digest', v_digest,
      'legacy_version', p_legacy_version, 'migrated_at', now()));

  SELECT public.commerce_cart_assemble_state(v_merchant, v_cart_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false, 'state', v_state, 'currentVersion', 1);
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'invalid_line' OR SQLERRM = 'invalid_offer' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RAISE;
END;
$$;
-- Safe projection for order-route price validation under normal public RLS.
-- Inactive matching rows are included so callers reject instead of silently
-- falling back to the parent price; no private offer metadata is exposed.
CREATE OR REPLACE FUNCTION public.get_order_condition_prices(p_merchant_id uuid,p_product_ids uuid[])
RETURNS TABLE(product_id uuid,condition text,price numeric,status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(array_length(p_product_ids,1),0)<1 OR array_length(p_product_ids,1)>200 THEN RETURN; END IF;
 RETURN QUERY SELECT offer.product_id,offer.condition,CASE WHEN offer.status='active' AND public.commerce_cart_condition_pool_is_quantity_managed(p_merchant_id,product.id) THEN offer.price ELSE NULL::numeric END,CASE WHEN NOT public.commerce_cart_condition_pool_is_quantity_managed(p_merchant_id,product.id) THEN 'unsupported_inventory_policy' ELSE offer.status END
 FROM public.product_offers offer JOIN public.products product ON product.id=offer.product_id AND product.merchant_id=offer.merchant_id
 JOIN public.merchants merchant ON merchant.id=offer.merchant_id
 WHERE offer.merchant_id=p_merchant_id AND offer.product_id=ANY(p_product_ids) AND product.status='active'
  AND (coalesce(merchant.is_published,false) OR coalesce(merchant.is_platform_admin,false));
END $$;
REVOKE ALL ON FUNCTION public.get_order_condition_prices(uuid,uuid[]) FROM PUBLIC,service_role;
GRANT EXECUTE ON FUNCTION public.get_order_condition_prices(uuid,uuid[]) TO anon,authenticated;

CREATE OR REPLACE FUNCTION private.restock_order_items(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.product_offers offer SET stock_quantity=offer.stock_quantity+agg.quantity
  FROM (SELECT oi.product_offer_id,orders.merchant_id,oi.product_id,oi.condition,sum(oi.quantity)::integer AS quantity FROM public.order_items oi
    JOIN public.orders orders ON orders.id=oi.order_id
    JOIN public.products product ON product.id=oi.product_id AND product.merchant_id=orders.merchant_id

    WHERE oi.order_id=p_order_id AND oi.product_offer_id IS NOT NULL AND product.manage_stock=true GROUP BY oi.product_offer_id,orders.merchant_id,oi.product_id,oi.condition) agg
  WHERE offer.id=agg.product_offer_id AND offer.merchant_id=agg.merchant_id AND offer.product_id=agg.product_id AND offer.condition IS NOT DISTINCT FROM agg.condition;
  UPDATE public.product_variants v
  SET stock_quantity = v.stock_quantity + agg.qty
  FROM (
    SELECT oi.variant_id AS variant_id, SUM(oi.quantity)::int AS qty
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL
      AND oi.variant_id IS NOT NULL
      AND COALESCE(p.manage_stock, false) = true
    GROUP BY oi.variant_id
  ) agg
  WHERE v.id = agg.variant_id;

  UPDATE public.products p
  SET stock_quantity = COALESCE(p.stock_quantity, 0) + agg.qty
  FROM (
    SELECT oi.product_id AS product_id, SUM(oi.quantity)::int AS qty
    FROM public.order_items oi
    JOIN public.products pp ON pp.id = oi.product_id
    WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL
      AND oi.variant_id IS NULL
      AND oi.product_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
    GROUP BY oi.product_id
  ) agg
  WHERE p.id = agg.product_id;
END;
$$;
REVOKE ALL ON FUNCTION private.restock_order_items(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.restock_order_items_excluding_serialized(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.product_offers offer SET stock_quantity=offer.stock_quantity+agg.quantity
  FROM (SELECT oi.product_offer_id,orders.merchant_id,oi.product_id,oi.condition,sum(oi.quantity)::integer AS quantity FROM public.order_items oi
    JOIN public.orders orders ON orders.id=oi.order_id
    JOIN public.products product ON product.id=oi.product_id AND product.merchant_id=orders.merchant_id

    WHERE oi.order_id=p_order_id AND oi.product_offer_id IS NOT NULL AND product.manage_stock=true GROUP BY oi.product_offer_id,orders.merchant_id,oi.product_id,oi.condition) agg
  WHERE offer.id=agg.product_offer_id AND offer.merchant_id=agg.merchant_id AND offer.product_id=agg.product_id AND offer.condition IS NOT DISTINCT FROM agg.condition;
  UPDATE public.product_variants v
  SET stock_quantity = v.stock_quantity + agg.qty
  FROM (
    SELECT oi.variant_id AS variant_id, SUM(oi.quantity)::int AS qty
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.product_variants AS variant ON variant.id = oi.variant_id
    WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL
      AND oi.variant_id IS NOT NULL
      AND COALESCE(p.manage_stock, false) = true
      AND (p.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
        OR COALESCE(variant.inventory_tracking_policy, 'inherit')
          NOT IN ('inherit', 'serialized_strict'))
    GROUP BY oi.variant_id
  ) agg
  WHERE v.id = agg.variant_id;

  UPDATE public.products p
  SET stock_quantity = COALESCE(p.stock_quantity, 0) + agg.qty
  FROM (
    SELECT oi.product_id AS product_id, SUM(oi.quantity)::int AS qty
    FROM public.order_items oi
    JOIN public.products pp ON pp.id = oi.product_id
    WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL
      AND oi.variant_id IS NULL
      AND oi.product_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
    GROUP BY oi.product_id
  ) agg
  WHERE p.id = agg.product_id;
END;
$$;
REVOKE ALL ON FUNCTION private.restock_order_items_excluding_serialized(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.restock_order_items_excluding_redvault_releases(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.product_offers offer SET stock_quantity=offer.stock_quantity+agg.quantity
  FROM (SELECT oi.product_offer_id,orders.merchant_id,oi.product_id,oi.condition,sum(greatest(oi.quantity-coalesce(rel.released,0),0))::integer AS quantity FROM public.order_items oi
    JOIN public.orders orders ON orders.id=oi.order_id
    JOIN public.products product ON product.id=oi.product_id AND product.merchant_id=orders.merchant_id
    LEFT JOIN (
 SELECT link.order_item_id,count(*)::integer AS released FROM private.uba_redvault_refund_line_allocations link
 JOIN private.uba_redvault_refunds refund ON refund.id=link.refund_id
 JOIN private.uba_redvault_refund_lifecycle lifecycle ON lifecycle.refund_id=refund.id
 JOIN private.uba_redvault_payment_attempts attempt ON attempt.id=refund.attempt_id
 WHERE attempt.order_id=p_order_id AND refund.state='processed' AND lifecycle.inventory_state='released'
 GROUP BY link.order_item_id
 ) rel ON rel.order_item_id=oi.id
    WHERE oi.order_id=p_order_id AND oi.product_offer_id IS NOT NULL AND product.manage_stock=true GROUP BY oi.product_offer_id,orders.merchant_id,oi.product_id,oi.condition) agg
  WHERE offer.id=agg.product_offer_id AND offer.merchant_id=agg.merchant_id AND offer.product_id=agg.product_id AND offer.condition IS NOT DISTINCT FROM agg.condition;
  UPDATE public.product_variants v
  SET stock_quantity = v.stock_quantity + agg.qty
  FROM (
    SELECT oi.variant_id AS variant_id,
      SUM(CASE
        WHEN p.inventory_tracking_policy = 'serialized_strict'
          AND COALESCE(variant.inventory_tracking_policy, 'inherit') IN ('inherit', 'serialized_strict')
        THEN oi.quantity
        ELSE GREATEST(oi.quantity - COALESCE(rel.released, 0), 0)
      END)::int AS qty
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.product_variants AS variant ON variant.id = oi.variant_id
    LEFT JOIN (
      SELECT link.order_item_id, count(*)::int AS released
      FROM private.uba_redvault_refund_line_allocations AS link
      JOIN private.uba_redvault_refunds AS refund ON refund.id = link.refund_id
      JOIN private.uba_redvault_refund_lifecycle AS lifecycle ON lifecycle.refund_id = refund.id
      JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
      WHERE attempt.order_id = p_order_id
        AND refund.state = 'processed'
        AND lifecycle.inventory_state = 'released'
      GROUP BY link.order_item_id
    ) rel ON rel.order_item_id = oi.id
    WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL
      AND oi.variant_id IS NOT NULL
      AND COALESCE(p.manage_stock, false) = true
    GROUP BY oi.variant_id
  ) agg
  WHERE v.id = agg.variant_id;

  UPDATE public.products p
  SET stock_quantity = COALESCE(p.stock_quantity, 0) + agg.qty
  FROM (
    SELECT oi.product_id AS product_id,
      SUM(CASE
        WHEN pp.inventory_tracking_policy = 'serialized_strict'
        THEN oi.quantity
        ELSE GREATEST(oi.quantity - COALESCE(rel.released, 0), 0)
      END)::int AS qty
    FROM public.order_items oi
    JOIN public.products pp ON pp.id = oi.product_id
    LEFT JOIN (
      SELECT link.order_item_id, count(*)::int AS released
      FROM private.uba_redvault_refund_line_allocations AS link
      JOIN private.uba_redvault_refunds AS refund ON refund.id = link.refund_id
      JOIN private.uba_redvault_refund_lifecycle AS lifecycle ON lifecycle.refund_id = refund.id
      JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
      WHERE attempt.order_id = p_order_id
        AND refund.state = 'processed'
        AND lifecycle.inventory_state = 'released'
      GROUP BY link.order_item_id
    ) rel ON rel.order_item_id = oi.id
    WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL
      AND oi.variant_id IS NULL
      AND oi.product_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
    GROUP BY oi.product_id
  ) agg
  WHERE p.id = agg.product_id;
END;
$$;
REVOKE ALL ON FUNCTION private.restock_order_items_excluding_redvault_releases(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.release_redvault_refund_quantity_units(p_refund_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_refund private.uba_redvault_refunds%ROWTYPE;
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_request record;
  v_item public.order_items%ROWTYPE;
  v_restocked integer := 0;
  v_quantity_lines integer := 0;
  v_refunded_total integer;
  v_surviving integer;
BEGIN
  SELECT * INTO STRICT v_refund FROM private.uba_redvault_refunds WHERE id = p_refund_id;
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts WHERE id = v_refund.attempt_id;
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_attempt.order_id FOR UPDATE;
  IF v_refund.state <> 'processed' OR v_refund.refund_type <> 'merchandise_units'
    OR v_order.shipping_status NOT IN ('pending', 'processing') OR v_order.cancelled_at IS NOT NULL
    OR v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL
    OR v_order.shipped_at IS NOT NULL OR v_order.delivered_at IS NOT NULL
    OR v_order.shipment_booking_lock_token IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.shipments WHERE order_id = v_order.id) THEN
    RAISE EXCEPTION 'redvault_partial_refund_inventory_requires_review';
  END IF;
  FOR v_request IN
    SELECT allocation.order_item_id, count(*)::integer AS requested_count
    FROM private.uba_redvault_refund_line_allocations AS allocation
    WHERE allocation.refund_id = p_refund_id
    GROUP BY allocation.order_item_id
  LOOP
    SELECT * INTO STRICT v_item FROM public.order_items WHERE id = v_request.order_item_id
      AND order_id = v_order.id FOR UPDATE;
    -- Routing follows reservation reality, not the mutable catalog
    -- policy: a line serialized at order time keeps its unit
    -- reservations even if the merchant later flips the policy to
    -- off, while the stock sync only touches currently-serialized
    -- products. The quantity path therefore runs unless the line is
    -- BOTH historically and currently serialized (unit release plus
    -- stock sync own that case): flipped lines still need this
    -- restock, and never-serialized lines are unaffected either way.
    IF private.redvault_line_was_serialized(v_order.id, v_request.order_item_id)
      AND EXISTS (
        SELECT 1 FROM public.products AS product
        LEFT JOIN public.product_variants AS variant ON variant.id = v_item.variant_id
        WHERE product.id = v_item.product_id
          AND product.inventory_tracking_policy = 'serialized_strict'
          AND (v_item.variant_id IS NULL OR COALESCE(variant.inventory_tracking_policy, 'inherit')
            IN ('inherit', 'serialized_strict'))
      ) THEN CONTINUE; END IF;
    v_quantity_lines := v_quantity_lines + 1;
    -- Mirror restock_order_items level selection: variant stock when a
    -- variant is set, product stock otherwise, gated on manage_stock.
    IF v_item.product_offer_id IS NOT NULL THEN
      UPDATE public.product_offers offer SET stock_quantity=offer.stock_quantity+v_request.requested_count
      FROM public.products product WHERE offer.id=v_item.product_offer_id AND offer.product_id=v_item.product_id
        AND offer.merchant_id=v_order.merchant_id AND offer.condition IS NOT DISTINCT FROM v_item.condition AND product.id=offer.product_id AND product.manage_stock=true;
    ELSIF v_item.variant_id IS NOT NULL THEN
      UPDATE public.product_variants AS variant
      SET stock_quantity = COALESCE(variant.stock_quantity, 0) + v_request.requested_count
      FROM public.products AS product
      WHERE variant.id = v_item.variant_id AND product.id = v_item.product_id
        AND product.manage_stock = true;
    ELSE
      UPDATE public.products AS product
      SET stock_quantity = COALESCE(product.stock_quantity, 0) + v_request.requested_count
      WHERE product.id = v_item.product_id AND product.manage_stock = true;
    END IF;
    IF FOUND THEN
      v_restocked := v_restocked + v_request.requested_count;
    END IF;
    -- The surviving shippable count always reconciles, even for untracked
    -- lines with no stock to restore: without it booking ships refunded
    -- units at the original quantity.
    SELECT count(*) INTO v_refunded_total
    FROM private.uba_redvault_refund_line_allocations AS allocation
    JOIN private.uba_redvault_refunds AS refund ON refund.id = allocation.refund_id
    WHERE allocation.order_item_id = v_item.id
      AND refund.attempt_id = v_attempt.id
      AND refund.state = 'processed';
    v_surviving := GREATEST(v_item.quantity - v_refunded_total, 0);
    UPDATE public.order_items
    SET fulfillment_data = COALESCE(fulfillment_data, '{}'::jsonb)
      || jsonb_build_object('fulfillmentQuantity', v_surviving)
    WHERE id = v_item.id;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'refundId', p_refund_id, 'restockedCount', v_restocked,
    'quantityLines', v_quantity_lines);
END;
$$;
REVOKE ALL ON FUNCTION private.release_redvault_refund_quantity_units(uuid) FROM PUBLIC,anon,authenticated,service_role;
