-- Customer spending is paid order value excluding cancelled orders. It is not
-- a payment or refund ledger. Preserve order counts, including cancelled orders.
CREATE OR REPLACE FUNCTION public.fn_update_customer_stats()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old_customer uuid;
  v_new_customer uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_customer := OLD.customer_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_customer := NEW.customer_id; END IF;

  UPDATE public.customers AS c
  SET total_orders = (SELECT count(*) FROM public.orders AS o WHERE o.customer_id = c.id),
      total_spent = COALESCE((SELECT sum(o.total) FROM public.orders AS o
        WHERE o.customer_id = c.id
          AND lower(btrim(COALESCE(o.payment_status, ''))) = 'paid'
          AND lower(btrim(COALESCE(o.shipping_status, ''))) NOT IN ('cancelled', 'canceled')), 0),
      updated_at = now()
  WHERE c.id IN (v_old_customer, v_new_customer);
  RETURN NULL;
END;
$$;

-- Keep receipt redemption from overwriting the trigger's old-customer refresh
-- with the previous definition of spending.
CREATE OR REPLACE FUNCTION private.redeem_manual_order_claim_order_scoped(
  p_claim_id uuid, p_user_id uuid, p_email text, p_source text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claim public.receipt_claims%ROWTYPE;
  v_owner public.customers%ROWTYPE;
  v_order_count integer;
  v_source text := CASE
    WHEN lower(btrim(COALESCE(p_source, ''))) IN ('web', 'app')
      THEN lower(btrim(p_source))
    ELSE 'unknown'
  END;
BEGIN
  SELECT rc.* INTO v_claim FROM public.receipt_claims AS rc
  WHERE rc.id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF v_claim.claimed_by_user_id IS NOT NULL
    AND v_claim.claimed_by_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('status', 'already_used');
  END IF;
  -- Lock the claimed orders before verifying so a concurrent customer
  -- re-link cannot slip between the check and the re-pointing below.
  PERFORM 1 FROM public.orders AS o
  WHERE o.id IN (SELECT rco.order_id FROM public.receipt_claim_orders AS rco
                 WHERE rco.receipt_claim_id = v_claim.id)
  FOR UPDATE;
  -- Reuse the verified user's existing row first: after an auth-email
  -- change the email lookup below would create a second row and the user_id
  -- assignment would violate idx_customers_merchant_user, 500ing the
  -- redemption. The row's stale email is harmless: the order email stays
  -- the contact channel.
  SELECT c.* INTO v_owner FROM public.customers AS c
  WHERE c.merchant_id IS NOT DISTINCT FROM v_claim.merchant_id
    AND c.user_id = p_user_id
    AND c.deleted_at IS NULL
  LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    SELECT c.* INTO v_owner FROM public.customers AS c
    WHERE c.merchant_id IS NOT DISTINCT FROM v_claim.merchant_id
      AND lower(btrim(COALESCE(c.email, ''))) = p_email
    ORDER BY c.deleted_at NULLS FIRST
    LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      -- Insert the normalized redeemer email: the claim row stores the
      -- raw recipient spelling, but the merchant/email unique index is
      -- case-sensitive, so a raw insert would let a later normalized
      -- insert double the row. The explicit target names that index.
      INSERT INTO public.customers (merchant_id, email)
      VALUES (v_claim.merchant_id, p_email)
      ON CONFLICT (merchant_id, email) WHERE (email IS NOT NULL) DO NOTHING
      RETURNING * INTO v_owner;
      IF NOT FOUND THEN
        -- Same live-first ordering as the email lookup above: under a
        -- race the conflicting holder may be soft-deleted while a live
        -- row for the verified redeemer exists, and an unordered pick
        -- could return the dead row and strand the redemption.
        SELECT c.* INTO v_owner FROM public.customers AS c
        WHERE c.merchant_id IS NOT DISTINCT FROM v_claim.merchant_id
          AND lower(btrim(COALESCE(c.email, ''))) = p_email
        ORDER BY c.deleted_at NULLS FIRST
        LIMIT 1 FOR UPDATE;
      END IF;
    END IF;
  END IF;
  IF v_owner.id IS NULL OR v_owner.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'customer_link_failed');
  END IF;
  IF v_owner.user_id IS NOT NULL AND v_owner.user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('status', 'customer_link_failed');
  END IF;
  -- Every claimed order must still sit on the claimed row, or already sit
  -- on the redeemer-linked owner row: an invoice claim and a receipt claim
  -- for the same order both start on the stale row, and the first redeem
  -- moves the order, so the sibling must accept the post-move state
  -- instead of stranding its own document. Accepting only the
  -- redeemer-linked row keeps this safe: orders on anyone else's row
  -- still fail closed above or here.
  SELECT count(*) INTO v_order_count
  FROM public.orders AS o
  WHERE o.id IN (SELECT rco.order_id FROM public.receipt_claim_orders AS rco
                 WHERE rco.receipt_claim_id = v_claim.id)
    AND o.merchant_id IS NOT DISTINCT FROM v_claim.merchant_id
    AND (o.customer_id IS NOT DISTINCT FROM v_claim.customer_id
      OR (o.customer_id IS NOT DISTINCT FROM v_owner.id
        AND v_owner.user_id = p_user_id));
  IF v_order_count = 0
    OR v_order_count IS DISTINCT FROM (SELECT count(*) FROM public.receipt_claim_orders AS rco
                                       WHERE rco.receipt_claim_id = v_claim.id) THEN
    RETURN jsonb_build_object('status', 'customer_link_failed');
  END IF;
  -- A soft-deleted row still holds its user_id under the unique index, so
  -- assigning p_user_id to a different row would 500 on conflict: when the
  -- owner isn't already the linked row, any other holder fails the link.
  IF v_owner.user_id IS DISTINCT FROM p_user_id AND EXISTS (
    SELECT 1 FROM public.customers AS c
    WHERE c.merchant_id IS NOT DISTINCT FROM v_claim.merchant_id
      AND c.user_id = p_user_id
      AND c.id IS DISTINCT FROM v_owner.id
  ) THEN
    RETURN jsonb_build_object('status', 'customer_link_failed');
  END IF;
  UPDATE public.customers AS c
  SET user_id = p_user_id, last_login_at = now(), updated_at = now()
  WHERE c.id = v_owner.id AND (c.user_id IS NULL OR c.user_id = p_user_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'customer_link_failed'); END IF;
  -- Trusted relink: customer_id is not rendered, so shield this UPDATE
  -- from dispatch invalidation (transaction-local; auto-reverts).
  PERFORM set_config('manual_document.trusted_relink', 'on', true);
  UPDATE public.orders AS o
  SET customer_id = v_owner.id, updated_at = now()
  WHERE o.id IN (SELECT rco.order_id FROM public.receipt_claim_orders AS rco
                 WHERE rco.receipt_claim_id = v_claim.id);
  PERFORM set_config('manual_document.trusted_relink', 'off', true);
  -- The order trigger refreshes both customer rows on a relink.
  UPDATE public.receipt_claims AS rc
  SET customer_id = v_owner.id,
    claimed_at = COALESCE(claimed_at, now()),
    claimed_by_user_id = p_user_id,
    first_clicked_at = COALESCE(first_clicked_at, now()),
    last_clicked_at = now(),
    first_click_source = CASE
      WHEN first_clicked_at IS NULL THEN v_source
      ELSE first_click_source
    END,
    last_click_source = v_source,
    click_count = CASE
      WHEN first_clicked_at IS NULL THEN click_count + 1
      ELSE click_count
    END,
    claimed_source = CASE
      WHEN claimed_source IS NULL THEN v_source
      ELSE claimed_source
    END,
    last_viewed_at = now(),
    updated_at = now()
  WHERE rc.id = v_claim.id;
  RETURN jsonb_build_object('status', 'ok', 'redirectPath', '/receipts');
END;
$$;
