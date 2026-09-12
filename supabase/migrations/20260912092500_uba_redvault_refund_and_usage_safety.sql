CREATE OR REPLACE FUNCTION private.enforce_redvault_redemption_usage_limits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_code public.discount_codes%ROWTYPE;
  v_limits jsonb;
  v_campaign_limit bigint;
  v_customer_limit bigint;
  v_campaign_count bigint;
  v_customer_count bigint;
BEGIN
  SELECT * INTO v_code FROM public.discount_codes
  WHERE id = NEW.discount_code_id AND merchant_id = NEW.merchant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_binding_invalid'; END IF;
  SELECT commercial_terms->'usage_limits' INTO v_limits
  FROM private.uba_redvault_runtime WHERE partnership = 'uba_redvault';
  IF jsonb_typeof(v_limits) IS DISTINCT FROM 'object'
    OR NOT (v_limits ?& ARRAY['usage_limit', 'usage_limit_per_customer'])
    OR (SELECT count(*) FROM jsonb_object_keys(v_limits)) <> 2
    OR EXISTS (
      SELECT 1 FROM jsonb_each(v_limits)
      WHERE value <> 'null'::jsonb AND (
        jsonb_typeof(value) <> 'number' OR value::text !~ '^(0|[1-9][0-9]*)$'
        OR length(value::text) > 9
      )
    ) THEN RAISE EXCEPTION 'redvault_usage_limits_unconfirmed'; END IF;
  IF COALESCE(v_code.usage_count, 0) < 0 OR v_code.usage_limit < 0
    OR v_code.usage_limit_per_customer < 0 THEN
    RAISE EXCEPTION 'redvault_usage_limits_invalid';
  END IF;
  v_campaign_limit := least(v_code.usage_limit, (v_limits->>'usage_limit')::bigint);
  v_customer_limit := least(v_code.usage_limit_per_customer, (v_limits->>'usage_limit_per_customer')::bigint);
  SELECT count(*), count(*) FILTER (
    WHERE lower(trim(customer_email)) = lower(trim(NEW.customer_email))
  ) INTO v_campaign_count, v_customer_count
  FROM private.uba_redvault_redemptions WHERE discount_code_id = NEW.discount_code_id;
  v_campaign_count := v_campaign_count + greatest(COALESCE(v_code.usage_count, 0), (
    SELECT count(*) FROM public.discount_code_usage WHERE discount_code_id = NEW.discount_code_id
  ));
  v_customer_count := v_customer_count + (
    SELECT count(*) FROM public.discount_code_usage
    WHERE discount_code_id = NEW.discount_code_id
      AND lower(trim(customer_email)) = lower(trim(NEW.customer_email))
  );
  IF v_campaign_count >= v_campaign_limit THEN RAISE EXCEPTION 'redvault_campaign_usage_limit_reached'; END IF;
  IF v_customer_count >= v_customer_limit THEN RAISE EXCEPTION 'redvault_customer_usage_limit_reached'; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_redvault_redemption_usage_limits() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_redvault_redemption_usage_limits() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enforce_redvault_redemption_usage_limits
  BEFORE INSERT ON private.uba_redvault_redemptions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_redvault_redemption_usage_limits();
COMMENT ON FUNCTION private.enforce_redvault_redemption_usage_limits() IS
  'Usage terms must explicitly contain usage_limit and usage_limit_per_customer, each an integer 0..999999999 or null for uncapped. The stricter discount-code cap applies. Historical redemptions are not restored by refunds.';

CREATE TABLE private.uba_redvault_refund_lifecycle (
  refund_id uuid PRIMARY KEY REFERENCES private.uba_redvault_refunds(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  financial_state text NOT NULL CHECK (financial_state IN ('refunded', 'review_required')),
  inventory_state text NOT NULL CHECK (inventory_state IN ('released', 'review_required')),
  review_reason text,
  inventory_receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX uba_redvault_refund_lifecycle_order_idx ON private.uba_redvault_refund_lifecycle(order_id);
ALTER TABLE private.uba_redvault_refund_lifecycle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.uba_redvault_refund_lifecycle FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY redvault_refund_lifecycle_no_direct_access
  ON private.uba_redvault_refund_lifecycle AS RESTRICTIVE FOR ALL
  TO anon, authenticated, service_role USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION private.finalize_redvault_processed_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_receipt jsonb;
  v_financial_state text := 'review_required';
  v_inventory_state text := 'review_required';
  v_reason text := 'partial_units_require_fulfillment_reconciliation';
  v_had_context boolean;
BEGIN
  IF NEW.state <> 'processed' OR EXISTS (
    SELECT 1 FROM private.uba_redvault_refund_lifecycle WHERE refund_id = NEW.id
  ) THEN RETURN NEW; END IF;
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts WHERE id = NEW.attempt_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || v_attempt.order_id::text, 0));
  IF (SELECT sum(amount_kobo) FROM private.uba_redvault_refunds
    WHERE attempt_id = v_attempt.id AND state = 'processed') = v_attempt.amount_kobo THEN
    v_reason := 'inventory_and_logistics_require_review';
    IF (SELECT count(*) FROM public.transactions WHERE order_id = v_attempt.order_id
      AND merchant_id = v_attempt.merchant_id AND gateway = 'paystack'
      AND gateway_reference = v_attempt.reference AND transaction_type = 'payment') = 1 THEN
      SELECT * INTO v_transaction FROM public.transactions WHERE order_id = v_attempt.order_id
        AND merchant_id = v_attempt.merchant_id AND gateway = 'paystack'
        AND gateway_reference = v_attempt.reference AND transaction_type = 'payment' FOR UPDATE;
      SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_attempt.order_id FOR UPDATE;
      IF v_order.merchant_id = v_attempt.merchant_id AND v_order.payment_method = 'uba_redvault'
        AND round(v_transaction.amount * 100)::bigint = v_attempt.amount_kobo
        AND upper(v_transaction.currency) = v_attempt.currency
        AND v_transaction.status IN ('pending', 'completed', 'refunded')
        AND v_order.payment_status IN ('unpaid', 'paid', 'refunded') THEN
        SELECT EXISTS (SELECT 1 FROM private.uba_redvault_write_context
          WHERE transaction_id = pg_catalog.txid_current()) INTO v_had_context;
        INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
        UPDATE public.transactions SET status = 'refunded', updated_at = now()
          WHERE id = v_transaction.id;
        UPDATE public.orders SET payment_status = 'refunded', updated_at = now()
          WHERE id = v_order.id;
        v_financial_state := 'refunded';
        IF v_order.shipping_status IN ('pending', 'processing')
          AND v_order.cancelled_at IS NULL AND v_order.shipment_id IS NULL
          AND v_order.tracking_number IS NULL AND v_order.shipped_at IS NULL AND v_order.delivered_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.shipments WHERE order_id = v_order.id)
          AND EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order.id)
          AND NOT EXISTS (
            SELECT 1 FROM public.order_items AS item
            LEFT JOIN public.products AS product ON product.id = item.product_id
            LEFT JOIN public.product_variants AS variant ON variant.id = item.variant_id
            WHERE item.order_id = v_order.id AND (
              product.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
              OR (item.variant_id IS NOT NULL AND (variant.id IS NULL
                OR COALESCE(variant.inventory_tracking_policy, 'inherit') NOT IN ('inherit', 'serialized_strict')))
            )
          )
          AND NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_id = v_order.id
            AND (status IS DISTINCT FROM 'reserved' OR sold_at IS NOT NULL)) THEN
          BEGIN
            v_receipt := private.release_order_inventory_units(v_order.merchant_id, v_order.id, 'available');
            IF (v_receipt->>'success')::boolean IS DISTINCT FROM true THEN
              RAISE EXCEPTION 'redvault_refund_inventory_release_failed';
            END IF;
            v_inventory_state := 'released';
            v_reason := NULL;
          EXCEPTION WHEN OTHERS THEN
            v_receipt := NULL;
            v_reason := 'inventory_release_requires_review';
          END;
        END IF;
        IF NOT v_had_context THEN
          DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
        END IF;
      ELSE v_reason := 'full_capture_financial_state_requires_review';
      END IF;
    ELSE v_reason := 'full_capture_transaction_requires_review';
    END IF;
  END IF;
  INSERT INTO private.uba_redvault_refund_lifecycle
    (refund_id, order_id, financial_state, inventory_state, review_reason, inventory_receipt)
  VALUES (NEW.id, v_attempt.order_id, v_financial_state, v_inventory_state, v_reason, v_receipt);
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.finalize_redvault_processed_refund() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.finalize_redvault_processed_refund() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER finalize_redvault_processed_refund
  AFTER INSERT OR UPDATE OF state ON private.uba_redvault_refunds
  FOR EACH ROW EXECUTE FUNCTION private.finalize_redvault_processed_refund();

UPDATE private.uba_redvault_refunds SET state = state WHERE state = 'processed';
