CREATE FUNCTION private.bank_card_offer_checkout_url_valid(p_url text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(length(p_url) <= 2048 AND p_url ~
    '^https://checkout[.]paystack[.]com/[A-Za-z0-9._~%/-]+([?][A-Za-z0-9._~%+&=;:@,/?-]+)?$', false);
$$;

CREATE OR REPLACE FUNCTION public.record_bank_card_offer_checkout_url(
  p_order_id uuid, p_merchant_id uuid, p_reference text, p_checkout_url text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.get_bank_card_offer_checkout_context(p_order_id, p_merchant_id) IS NULL
    OR NOT private.bank_card_offer_checkout_url_valid(p_checkout_url)
  THEN RETURN false; END IF;
  UPDATE private.bank_card_offer_payment_attempts a SET checkout_url = p_checkout_url
  FROM public.transactions t
  WHERE a.order_id = p_order_id AND t.id = a.transaction_id AND t.gateway_reference = p_reference
    AND (a.checkout_url IS NULL OR a.checkout_url = p_checkout_url);
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.flag_bank_card_offer_initialization_review(
  p_order_id uuid, p_merchant_id uuid, p_reference text, p_failed boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.get_bank_card_offer_checkout_context(p_order_id, p_merchant_id) IS NULL THEN RETURN; END IF;
  INSERT INTO public.reconciliation_review (issue_type, merchant_id, order_id, txn_id, paystack_ref, reason, metadata)
  SELECT 'gateway_payment_wedge_requires_review', p_merchant_id, p_order_id, t.id, p_reference,
    'Paystack checkout could not be recovered from its saved bank offer reference',
    jsonb_build_object('source', 'bank_card_offer_initialization')
  FROM private.bank_card_offer_payment_attempts a
  JOIN public.transactions t ON t.id = a.transaction_id
  WHERE a.order_id = p_order_id AND a.checkout_url IS NULL AND a.verified_evidence IS NULL
    AND t.gateway_reference = p_reference AND t.status = 'pending'
    AND (p_failed OR t.created_at < now() - interval '2 minutes')
  ON CONFLICT DO NOTHING;
END;
$$;

-- Operations can restore the authorization URL for the same reference from
-- Paystack. A missing verify response alone never authorizes a new attempt.
CREATE FUNCTION public.restore_bank_card_offer_checkout_url(p_review_id uuid, p_checkout_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review record;
BEGIN
  IF NOT private.bank_card_offer_checkout_url_valid(p_checkout_url) THEN RETURN false; END IF;
  SELECT id, merchant_id, order_id, txn_id, paystack_ref INTO v_review
  FROM public.reconciliation_review
  WHERE id = p_review_id AND issue_type = 'gateway_payment_wedge_requires_review'
    AND metadata->>'source' = 'bank_card_offer_initialization' AND resolved_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE private.bank_card_offer_payment_attempts a SET checkout_url = p_checkout_url
  FROM public.transactions t, public.orders o
  WHERE a.order_id = v_review.order_id AND a.transaction_id = v_review.txn_id
    AND t.id = a.transaction_id AND t.gateway_reference = v_review.paystack_ref
    AND o.id = a.order_id AND t.merchant_id = v_review.merchant_id AND o.merchant_id = v_review.merchant_id
    AND t.status = 'pending' AND o.payment_status = 'pending' AND o.cancelled_at IS NULL
    AND a.verified_evidence IS NULL AND (a.checkout_url IS NULL OR a.checkout_url = p_checkout_url);
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.reconciliation_review SET resolved_at = now() WHERE id = v_review.id;
  RETURN true;
END;
$$;

CREATE FUNCTION private.guard_bank_card_offer_order_economics()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.merchant_id, NEW.customer_id, NEW.customer_email, NEW.currency, NEW.subtotal, NEW.total,
      NEW.shipping_fee, NEW.tax_amount, NEW.tax_basis, NEW.gift_wrapping_fee, NEW.discount_amount)
    IS DISTINCT FROM
     (OLD.merchant_id, OLD.customer_id, OLD.customer_email, OLD.currency, OLD.subtotal, OLD.total,
      OLD.shipping_fee, OLD.tax_amount, OLD.tax_basis, OLD.gift_wrapping_fee, OLD.discount_amount)
    AND EXISTS (SELECT 1 FROM private.bank_card_offer_order_snapshots WHERE order_id = OLD.id)
  THEN RAISE EXCEPTION 'bank_card_offer_order_snapshot_immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_bank_card_offer_order_economics
  BEFORE UPDATE OF merchant_id, customer_id, customer_email, currency, subtotal, total,
    shipping_fee, tax_amount, tax_basis, gift_wrapping_fee, discount_amount ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_card_offer_order_economics();

CREATE FUNCTION private.guard_bank_card_offer_order_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old_order_id uuid;
  v_new_order_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_order_id := OLD.order_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_order_id := NEW.order_id; END IF;
  PERFORM 1 FROM public.orders WHERE id IN (v_old_order_id, v_new_order_id)
    AND payment_method = 'bank_card_offer' ORDER BY id FOR UPDATE;
  IF NOT FOUND THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  IF EXISTS (
    SELECT 1 FROM private.bank_card_offer_order_snapshots WHERE order_id IN (v_old_order_id, v_new_order_id)
  ) THEN RAISE EXCEPTION 'bank_card_offer_order_snapshot_immutable'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER guard_bank_card_offer_order_items
  BEFORE INSERT OR DELETE OR UPDATE OF id, order_id, product_id, variant_id, offer_id, condition,
    variant_attributes, line_id, price, quantity, assurance_fee, has_assurance, vat_rate, vat_category_code
  ON public.order_items FOR EACH ROW EXECUTE FUNCTION private.guard_bank_card_offer_order_items();

REVOKE ALL ON FUNCTION private.bank_card_offer_checkout_url_valid(text),
  private.guard_bank_card_offer_order_economics(), private.guard_bank_card_offer_order_items(),
  public.flag_bank_card_offer_initialization_review(uuid, uuid, text, boolean),
  public.restore_bank_card_offer_checkout_url(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.flag_bank_card_offer_initialization_review(uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_bank_card_offer_checkout_url(uuid, text) TO service_role;

-- Use only when Paystack confirms the reference cannot accept a payment.
-- A lookup miss or a timeout is insufficient. Keep the retired transaction
-- as an audit record and let the normal, locked claim create a fresh one.
CREATE FUNCTION public.retire_bank_card_offer_initialization(
  p_review_id uuid, p_provider_confirmation text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review record;
  v_transaction_id uuid;
BEGIN
  IF NULLIF(btrim(p_provider_confirmation), '') IS NULL OR length(p_provider_confirmation) > 500
    THEN RETURN false; END IF;
  SELECT id, merchant_id, order_id, txn_id, paystack_ref INTO v_review
  FROM public.reconciliation_review
  WHERE id = p_review_id AND issue_type = 'gateway_payment_wedge_requires_review'
    AND metadata->>'source' = 'bank_card_offer_initialization' AND resolved_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || v_review.order_id::text, 0));
  PERFORM 1 FROM public.orders WHERE id = v_review.order_id AND merchant_id = v_review.merchant_id
    AND payment_status = 'pending' AND cancelled_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM private.bank_card_offer_payment_attempts a
  USING public.transactions t
  WHERE a.order_id = v_review.order_id AND a.transaction_id = v_review.txn_id
    AND t.id = a.transaction_id AND t.gateway_reference = v_review.paystack_ref
    AND t.merchant_id = v_review.merchant_id AND t.status = 'pending'
    AND a.checkout_url IS NULL AND a.verified_evidence IS NULL
  RETURNING a.transaction_id INTO v_transaction_id;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.transactions SET status = 'cancelled', updated_at = now() WHERE id = v_transaction_id;
  UPDATE public.orders SET payment_status = 'unpaid', updated_at = now() WHERE id = v_review.order_id;
  UPDATE public.reconciliation_review SET resolved_at = now(),
    metadata = metadata || jsonb_build_object('provider_confirmation', p_provider_confirmation)
    WHERE id = p_review_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.retire_bank_card_offer_initialization(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retire_bank_card_offer_initialization(uuid, text) TO service_role;
