-- Expose the merchant's shipping-insurance toggle through the storefront
-- payment-settings RPC so native add-to-cart can resolve the Smart Cart
-- Pro assurance default against the live merchant setting. The shared
-- assurance policy fails unknown settings to opt-out: without a
-- native-readable source, every native Ogabassey add would either
-- default a paid fee on blindly or lose the intended default-on. This
-- extends the existing SECURITY DEFINER RPC (anon/customer-safe, same
-- GRANTs) with one appended column; COALESCE keeps merchants without a
-- settings row fail-closed. Appended at the end of the RETURNS TABLE so
-- existing positional readers are unaffected. Reruns converge: CREATE
-- OR REPLACE re-applies the same definition.
CREATE OR REPLACE FUNCTION public.get_storefront_payment_settings(
  p_merchant_id uuid
) RETURNS TABLE(
  paystack_enabled boolean,
  korapay_enabled boolean,
  juicyway_enabled boolean,
  credpal_enabled boolean,
  credit_direct_enabled boolean,
  klump_enabled boolean,
  pay_on_delivery_enabled boolean,
  vat_registration_status text,
  vat_rate numeric,
  klump_min_amount numeric,
  klump_max_amount numeric,
  wallet_paystack_dva_enabled boolean,
  wallet_order_auto_debit_enabled boolean,
  shipping_insurance_enabled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    COALESCE(s.paystack_enabled, true) AS paystack_enabled,
    COALESCE(s.korapay_enabled, false) AS korapay_enabled,
    COALESCE(s.juicyway_enabled, false) AS juicyway_enabled,
    COALESCE(s.credpal_enabled, false) AS credpal_enabled,
    COALESCE(s.credit_direct_enabled, false) AS credit_direct_enabled,
    COALESCE(s.klump_enabled, false) AS klump_enabled,
    COALESCE(s.pay_on_delivery_enabled, false) AS pay_on_delivery_enabled,
    COALESCE(m.vat_registration_status, 'not_registered') AS vat_registration_status,
    COALESCE(m.vat_rate, 7.5) AS vat_rate,
    COALESCE(s.klump_min_amount, 10000) AS klump_min_amount,
    COALESCE(s.klump_max_amount, 1000000) AS klump_max_amount,
    COALESCE(s.wallet_paystack_dva_enabled, false) AS wallet_paystack_dva_enabled,
    COALESCE(s.wallet_order_auto_debit_enabled, false) AS wallet_order_auto_debit_enabled,
    COALESCE(s.shipping_insurance_enabled, false) AS shipping_insurance_enabled
  FROM public.merchants m
  LEFT JOIN public.merchant_feature_settings s ON s.merchant_id = m.id
  WHERE m.id = p_merchant_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_storefront_payment_settings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_payment_settings(uuid) TO anon, authenticated, service_role;
