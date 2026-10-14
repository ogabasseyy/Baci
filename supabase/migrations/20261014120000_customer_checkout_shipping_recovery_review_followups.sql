-- Recovery review follow-ups: quote surviving units and let account deletion cascade.
--
-- 1. The recovery context projected only original order quantities, so after a
--    merchandise partial refund finished reconciliation, the fresh carrier quote
--    was calculated for refunded units. The booking path ships surviving units
--    (fulfillment_data.fulfillmentQuantity via survivingShipmentQuantity), so the
--    context now exposes the same surviving quantity per item and the API builds
--    the recovery quote from it. Fully refunded lines resolve to zero and are
--    dropped from the quote request by the API.
-- 2. The previews table used default NO ACTION foreign keys, so any recovery
--    preview blocked merchant/order deletion even though sibling tables cascade.
--    Recovery previews are PII-bearing ephemeral rows; they cascade with the
--    owning order/merchant like every other dependent table.
CREATE OR REPLACE FUNCTION public.get_customer_checkout_shipping_recovery_context(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE; v_items jsonb;
BEGIN
  v_order := private.assert_customer_checkout_shipping_recovery(p_order_id);
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',i.id,'name',i.name,'quantity',i.quantity,'price',i.price,'product_id',i.product_id,
    'fulfillment_quantity',(CASE WHEN (i.fulfillment_data->>'fulfillmentQuantity') ~ '^[0-9]{1,9}$'
      THEN (i.fulfillment_data->>'fulfillmentQuantity')::int
      ELSE GREATEST(COALESCE(i.quantity,1),0) END),
    'product',pg_catalog.jsonb_build_object('weight_value',p.weight_value,'weight_unit',p.weight_unit,
      'dimensions',p.dimensions,'commodity_code',p.commodity_code)) ORDER BY i.id),'[]'::jsonb)
    INTO v_items FROM public.order_items i LEFT JOIN public.products p ON p.id=i.product_id
    WHERE i.order_id=p_order_id;
  -- Internal quote cost/margins, payment secrets and provider payloads stay private.
  RETURN pg_catalog.jsonb_build_object('fingerprint',
    private.customer_checkout_shipping_recovery_fingerprint(p_order_id),
    'quote_preference',(SELECT pg_catalog.jsonb_build_object('service_tier',q.service_tier,
      'carrier_name',q.carrier_name,'provider_rate_id',q.provider_rate_id,
      'is_station_pickup',q.is_station_pickup) FROM public.shipping_quotes q
      WHERE q.id=v_order.selected_quote_id AND q.merchant_id=v_order.merchant_id),'order',
    pg_catalog.jsonb_build_object('id',v_order.id,'merchant_id',v_order.merchant_id,
      'customer_name',v_order.customer_name,'customer_email',v_order.customer_email,
      'customer_phone',v_order.customer_phone,'shipping_address',v_order.shipping_address,
      'shipping_fee',v_order.shipping_fee,'order_items',v_items));
END;
$$;
ALTER TABLE private.customer_checkout_shipping_recovery_previews
  DROP CONSTRAINT IF EXISTS customer_checkout_shipping_recovery_previews_order_id_fkey,
  ADD CONSTRAINT customer_checkout_shipping_recovery_previews_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE private.customer_checkout_shipping_recovery_previews
  DROP CONSTRAINT IF EXISTS customer_checkout_shipping_recovery_previews_merchant_id_fkey,
  ADD CONSTRAINT customer_checkout_shipping_recovery_previews_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
-- ---------------------------------------------------------------------------
-- Retention sweep: unconfirmed previews hold customer PII (original destination
-- plus the signed replacement quote) with an expiry of at most five minutes.
-- Confirmed rows stay as audit evidence; abandoned rows are purged past a
-- short grace window so expiry actually bounds PII retention. Follows the
-- mcp-guest-cart sweep pattern: bounded batch, service-role only, pg_cron
-- schedule guarded on the cron schema existing (no-op in a from-scratch
-- replay), re-runnable by unscheduling the prior job of the same name first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_customer_checkout_shipping_recovery_previews(
  p_limit integer DEFAULT 1000,
  p_retention interval DEFAULT interval '1 day'
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_deleted bigint;
BEGIN
  WITH doomed AS (
    SELECT id
    FROM private.customer_checkout_shipping_recovery_previews
    WHERE confirmed_at IS NULL
      AND expires_at < pg_catalog.clock_timestamp() - p_retention
    ORDER BY expires_at
    LIMIT GREATEST(COALESCE(p_limit, 1000), 1)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM private.customer_checkout_shipping_recovery_previews t
  USING doomed
  WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
COMMENT ON FUNCTION public.cleanup_customer_checkout_shipping_recovery_previews(integer, interval) IS
  'Recovery preview retention: purges unconfirmed PII-bearing rows past expiry plus a grace window; confirmed audit rows are kept. Service-role only, run by the pg_cron schedule below.';
ALTER FUNCTION public.cleanup_customer_checkout_shipping_recovery_previews(integer, interval) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.cleanup_customer_checkout_shipping_recovery_previews(integer, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_customer_checkout_shipping_recovery_previews(integer, interval)
  TO service_role;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'customer-checkout-shipping-recovery-cleanup'
    ) THEN
      PERFORM cron.unschedule('customer-checkout-shipping-recovery-cleanup');
    END IF;
    PERFORM cron.schedule(
      'customer-checkout-shipping-recovery-cleanup',
      '7 * * * *',
      $cron$SELECT public.cleanup_customer_checkout_shipping_recovery_previews(1000)$cron$
    );
  END IF;
END $$;
