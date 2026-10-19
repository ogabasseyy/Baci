-- Bound checkouts must honor loyalty codes with the same precedence
-- as direct checkouts (savings, quiz voucher, discount code, loyalty
-- code, base). The binding function previously rejected or silently
-- dropped the loyalty variant, so a shared-cart checkout presenting
-- a loyalty code would have lost its redemption. Patch the installed
-- function definition in place: extend the variant allowlist and add
-- the loyalty dispatch branch, mirroring the discount branch's named
-- arguments plus the redemption id.
DO $$
DECLARE
  v_def text := pg_get_functiondef(
    'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)'::regprocedure
  );
BEGIN
  IF position('loyalty_code' IN v_def) > 0 THEN
    RAISE EXCEPTION 'binding loyalty variant already installed';
  END IF;
  IF position(
    'p_variant NOT IN (''base'', ''savings'', ''quiz_voucher'', ''discount_code'')'
    IN v_def
  ) = 0 THEN
    RAISE EXCEPTION 'binding variant allowlist anchor not found';
  END IF;
  IF position(
    '  v_code uuid;' IN v_def
  ) = 0 THEN
    RAISE EXCEPTION 'binding declare anchor not found';
  END IF;
  IF position(
    '  ELSE' || chr(10) ||
    '    v_code := nullif(p_args ->> ''p_discount_code_id'', '''')::uuid;'
    IN v_def
  ) = 0 THEN
    RAISE EXCEPTION 'binding discount branch anchor not found';
  END IF;

  v_def := replace(
    v_def,
    'p_variant NOT IN (''base'', ''savings'', ''quiz_voucher'', ''discount_code'')',
    'p_variant NOT IN (''base'', ''savings'', ''quiz_voucher'', ''discount_code'', ''loyalty_code'')'
  );
  v_def := replace(
    v_def,
    '  v_code uuid;',
    '  v_code uuid;' || chr(10) || '  v_loyalty uuid;'
  );
  v_def := replace(
    v_def,
    '  ELSE' || chr(10) ||
    '    v_code := nullif(p_args ->> ''p_discount_code_id'', '''')::uuid;',
    '  ELSIF p_variant = ''loyalty_code'' THEN' || chr(10) ||
    '    v_loyalty := nullif(p_args ->> ''p_loyalty_redemption_id'', '''')::uuid;' || chr(10) ||
    '    SELECT * INTO v_order' || chr(10) ||
    '    FROM public.create_storefront_order_with_loyalty_code(' || chr(10) ||
    '      p_merchant_id := v_merchant, p_customer_email := v_email, p_customer_name := v_name,' || chr(10) ||
    '      p_items := v_items, p_customer_phone := v_phone, p_shipping_fee := v_ship_fee,' || chr(10) ||
    '      p_discount_amount := v_discount, p_tax_amount := v_tax, p_payment_method := v_pay_method,' || chr(10) ||
    '      p_payment_status := v_pay_status, p_shipping_status := v_ship_status,' || chr(10) ||
    '      p_shipping_address := v_ship_addr, p_source := v_source, p_notes := v_notes,' || chr(10) ||
    '      p_ad_tracking := v_ad, p_selected_quote_id := v_quote, p_shipping_provider := v_provider,' || chr(10) ||
    '      p_tracking_number := v_tracking, p_user_id := v_user, p_tax_basis := v_tax_basis,' || chr(10) ||
    '      p_gift_wrapping_fee := v_gift, p_expected_total := v_expected,' || chr(10) ||
    '      p_checkout_idempotency_key := v_key, p_checkout_request_hash := v_hash,' || chr(10) ||
    '      p_loyalty_redemption_id := v_loyalty' || chr(10) ||
    '    ) AS r;' || chr(10) ||
    '  ELSE' || chr(10) ||
    '    v_code := nullif(p_args ->> ''p_discount_code_id'', '''')::uuid;'
  );
  EXECUTE v_def;
END $$;
