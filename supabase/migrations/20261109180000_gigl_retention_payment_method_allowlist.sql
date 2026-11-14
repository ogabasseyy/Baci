-- Flip checkout shipping retention to a fail-safe ALLOW-LIST (follow-up to
-- 20261109120000 / PR #4132). Only payment methods whose money flow is verified
-- to route the GIG shipping fee to Baci may be stamped customer_checkout:
-- Paystack split card, Korapay, UBA RedVault split, Baci-held invoice/payforme
-- DVA, Juicyway, Klump, and internal credit (wallet, savings, store_credit).
-- Every other method -- credit_direct, oxygen, bank_transfer (merchant-subaccount
-- DVA), pod, cash, manual, marketplace imports, unknown or future providers,
-- NULL -- is non-retaining and books from the merchant shipping wallet.
-- Adding a provider requires evidence it records retained_shipping_amount.
-- Mirrors isGiglShippingRetainingPaymentMethod in
-- packages/shared/src/lib/gigl-shipping-retention-payment-methods.ts.
-- private.stamp_gigl_order_economics() already calls this helper by name.
CREATE OR REPLACE FUNCTION private.is_non_retaining_checkout_payment_method(p_method text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(p_method, ''))) NOT IN (
    'card', 'paystack', 'korapay', 'uba_redvault', 'invoice', 'payforme',
    'juicyway', 'klump', 'wallet', 'savings', 'store_credit'
  );
$$;
REVOKE ALL ON FUNCTION private.is_non_retaining_checkout_payment_method(text) FROM PUBLIC, anon, authenticated;

-- Backfill newly non-retaining methods (e.g. oxygen, bank_transfer) that were
-- stamped customer_checkout, unshipped, with no real settled retention.
UPDATE public.orders AS o
SET shipping_funding_source = NULL,
    shipping_platform_retained_amount = 0
WHERE o.shipping_funding_source = 'customer_checkout'
  AND private.is_non_retaining_checkout_payment_method(o.payment_method)
  AND o.shipment_id IS NULL
  AND o.tracking_number IS NULL
  AND pg_catalog.lower(COALESCE(o.shipping_status, '')) NOT IN ('shipped', 'delivered', 'cancelled')
  AND private.order_settled_gigl_retained_amount(o.id, o.merchant_id) <= 0;
