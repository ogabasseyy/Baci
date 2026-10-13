-- Address edits clear selected_quote_id while the order may still say
-- merchant_wallet. PostgreSQL runs same-timing BEFORE triggers by name, so
-- enforce_gigl_wallet_funding_source fires before stamp_gigl_order_economics
-- can drop the discriminator. Permit quote removal and let stamp clear it.
CREATE OR REPLACE FUNCTION private.enforce_gigl_wallet_funding_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.shipping_funding_source IS DISTINCT FROM 'merchant_wallet' THEN
    RETURN NEW;
  END IF;

  IF NEW.selected_quote_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.shipping_quotes AS sq
       JOIN public.shipping_quote_attestations AS a
         ON a.quote_id = sq.id
       WHERE sq.id = NEW.selected_quote_id
         AND sq.merchant_id = NEW.merchant_id
         AND sq.provider = 'GIGL'
         AND sq.currency = 'NGN'
         AND sq.pricing_version = 'gigl_platform_margin_v1'
         AND sq.is_station_pickup = false
         AND sq.expires_at > now()
         AND sq.session_id = NEW.id::text
         AND a.order_id = NEW.id
         AND a.merchant_id = NEW.merchant_id
         AND a.provider_rate_id IS NOT DISTINCT FROM sq.provider_rate_id
         AND a.quote_request IS NOT DISTINCT FROM sq.quote_request
         AND a.price IS NOT DISTINCT FROM sq.price
         AND a.provider_cost IS NOT DISTINCT FROM sq.provider_cost
         AND a.platform_margin IS NOT DISTINCT FROM sq.platform_margin
         AND a.currency IS NOT DISTINCT FROM sq.currency
         AND a.pricing_version IS NOT DISTINCT FROM sq.pricing_version
         AND a.expires_at IS NOT DISTINCT FROM sq.expires_at
         AND a.is_station_pickup IS NOT DISTINCT FROM sq.is_station_pickup
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.merchant_shipping_charges AS c
       WHERE c.order_id = NEW.id
         AND c.shipping_quote_id = NEW.selected_quote_id
         AND c.merchant_id = NEW.merchant_id
         AND c.status IS DISTINCT FROM 'refunded'
     ) THEN
    RAISE EXCEPTION 'merchant_wallet_funding_requires_attested_quote'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_gigl_wallet_funding_source() FROM PUBLIC;

COMMENT ON FUNCTION private.enforce_gigl_wallet_funding_source() IS
  'Rejects merchant-wallet order funding unless the selected GIGL quote is protected by an Admin attestation or an active wallet charge. Clearing selected_quote_id is allowed so stamp_gigl_order_economics can drop the funding discriminator.';
