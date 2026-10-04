-- Identity-safe redemption for manual claims whose customers row disagrees
-- with the verified recipient (staff corrected the order email without
-- re-linking the customer). Reassigning the mismatched row to the redeemer
-- would expose that row's other orders through the customer-scoped archive,
-- so this flow links ONLY the claimed orders: it finds or creates the
-- recipient's own customer row, links that row, and re-points the claimed
-- orders (and the claim) at it. The stranger's row is never touched.
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
        SELECT c.* INTO v_owner FROM public.customers AS c
        WHERE c.merchant_id IS NOT DISTINCT FROM v_claim.merchant_id
          AND lower(btrim(COALESCE(c.email, ''))) = p_email
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
  -- update_customer_stats_trigger recalculates only the NEW customer row
  -- on UPDATE, so refresh the previous row explicitly with the same
  -- aggregates: without this it permanently retains the moved orders in
  -- total_orders and, for paid orders, total_spent.
  UPDATE public.customers AS c
  SET total_orders = (SELECT count(*) FROM public.orders AS o
                      WHERE o.customer_id = v_claim.customer_id),
    total_spent = COALESCE((SELECT sum(o.total) FROM public.orders AS o
                            WHERE o.customer_id = v_claim.customer_id
                              AND o.payment_status = 'paid'), 0),
    updated_at = now()
  WHERE c.id = v_claim.customer_id
    AND v_claim.customer_id IS DISTINCT FROM v_owner.id;
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
REVOKE ALL ON FUNCTION private.redeem_manual_order_claim_order_scoped(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- Both the legacy and channel-aware public routes use live, verified identity.
-- Reusing the existing v2 core preserves click/channel tracking and same-user replay.
CREATE OR REPLACE FUNCTION private.redeem_verified_receipt_claim(
  p_token_hash text, p_source text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_verified_at timestamptz;
  v_claim public.receipt_claims%ROWTYPE;
  v_customer public.customers%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('status', 'unauthorized'); END IF;
  SELECT lower(btrim(u.email)), u.email_confirmed_at INTO v_email, v_verified_at
  FROM auth.users AS u WHERE u.id = v_user_id AND u.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unauthorized'); END IF;
  IF v_verified_at IS NULL THEN RETURN jsonb_build_object('status', 'email_unverified'); END IF;
  IF COALESCE(v_email, '') = ''
    OR v_email IS DISTINCT FROM lower(btrim(COALESCE(auth.jwt()->>'email', ''))) THEN
    RETURN jsonb_build_object('status', 'email_mismatch');
  END IF;
  SELECT rc.* INTO v_claim FROM public.receipt_claims AS rc
  WHERE rc.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    -- Previous-token grace: the bearer may hold the mailed link from the
    -- attempt before a retry rotation. All checks below run against the
    -- current row (email, expiry, linkage), so a corrected recipient
    -- still fails the old bearer closed.
    SELECT rc.* INTO v_claim FROM public.receipt_claims AS rc
    WHERE rc.previous_token_hash = p_token_hash
    LIMIT 1 FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    -- Delivered-token retention: the bearer may hold an accepted mail's
    -- link from before a rejected corrective attempt rotated the grace
    -- window past it. Same current-row checks as above.
    SELECT rc.* INTO v_claim FROM public.receipt_claims AS rc
    WHERE rc.delivered_token_hash = p_token_hash
    LIMIT 1 FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF v_claim.expires_at IS NOT NULL AND v_claim.expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  IF v_claim.customer_email_normalized IS DISTINCT FROM v_email THEN
    RETURN jsonb_build_object('status', 'email_mismatch');
  END IF;
  -- Lock-free read: this row only feeds the checks below, and holding it
  -- FOR UPDATE across the order-scoped path inverts the global claim ->
  -- order -> customer lock order (claim creation locks order FOR SHARE
  -- before customer FOR SHARE), deadlocking invoice redemption against a
  -- concurrent receipt-claim rotation on different claim rows. A stale read
  -- fails safe: the v2 core and order-scoped path re-lock and re-validate
  -- everything they act on.
  SELECT c.* INTO v_customer FROM public.customers AS c
  WHERE c.id = v_claim.customer_id AND c.merchant_id = v_claim.merchant_id
    AND c.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'customer_link_failed'); END IF;
  -- Import claims stay strict because the link is the only access path: the
  -- customers row must agree with the verified sign-in.
  IF v_claim.manual_notification_id IS NULL
    AND lower(btrim(v_customer.email)) IS DISTINCT FROM v_email THEN
    RETURN jsonb_build_object('status', 'email_mismatch');
  END IF;
  -- Manual documents arrive as email attachments, so a stale customers row
  -- (staff corrected the recipient without re-linking) must not strand the
  -- verified recipient. But reassigning the mismatched row would expose its
  -- other orders through the customer-scoped archive, so link ONLY the
  -- claimed orders instead of delegating to the row-linking core. A user
  -- already linked to a DIFFERENT row takes the same path even when the
  -- claim row's email matches: the row-linking core would assign the same
  -- user_id twice and violate idx_customers_merchant_user. The unique
  -- index covers soft-deleted rows too, so a deleted holder diverts as
  -- well; the order-scoped path reuses a live link and fails a dead one.
  IF v_claim.manual_notification_id IS NOT NULL
    AND (lower(btrim(v_customer.email)) IS DISTINCT FROM v_email
      OR EXISTS (SELECT 1 FROM public.customers AS c
                 WHERE c.merchant_id IS NOT DISTINCT FROM v_claim.merchant_id
                   AND c.user_id = v_user_id
                   AND c.id IS DISTINCT FROM v_customer.id)) THEN
    RETURN private.redeem_manual_order_claim_order_scoped(
      v_claim.id, v_user_id, v_email, p_source);
  END IF;
  -- Lock the claimed orders in claim -> order order before validating:
  -- the legacy core never rechecks receipt_claim_orders or the owner, so
  -- an unlocked check lets a concurrent staff customer_id change strand
  -- the consumed token on an order the redeemer cannot access.
  PERFORM 1 FROM public.orders AS o
  WHERE o.id IN (SELECT rco.order_id FROM public.receipt_claim_orders AS rco
                 WHERE rco.receipt_claim_id = v_claim.id)
  FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.receipt_claim_orders WHERE receipt_claim_id = v_claim.id)
    OR EXISTS (
      SELECT 1 FROM public.receipt_claim_orders AS rco JOIN public.orders AS o ON o.id = rco.order_id
      WHERE rco.receipt_claim_id = v_claim.id
        AND (o.merchant_id IS DISTINCT FROM v_claim.merchant_id
          OR o.customer_id IS DISTINCT FROM v_claim.customer_id)
    ) THEN RETURN jsonb_build_object('status', 'customer_link_failed'); END IF;
  -- The v2 core resolves by current token_hash only, so a graced
  -- previous-hash bearer hands over the row's current hash: same locked
  -- row, same re-validation, same click tracking.
  RETURN private.redeem_receipt_claim_v2(v_claim.token_hash, p_source);
END;
$$;
REVOKE ALL ON FUNCTION private.redeem_verified_receipt_claim(text, text)
  FROM PUBLIC, anon, authenticated;
-- The public wrappers stay SECURITY DEFINER (matching the delegates
-- hardening, which promotes pure-delegation wrappers): authenticated callers
-- have no USAGE on schema private, so INVOKER wrappers would 42501. Callers
-- need EXECUTE on the public wrappers only; the private implementation runs
-- as the owner either way.
CREATE OR REPLACE FUNCTION public.redeem_receipt_claim_v2(p_token_hash text, p_source text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.redeem_verified_receipt_claim(p_token_hash, p_source);
$$;
CREATE OR REPLACE FUNCTION public.redeem_receipt_claim(p_token_hash text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.redeem_verified_receipt_claim(p_token_hash, 'web');
$$;
REVOKE ALL ON FUNCTION private.redeem_receipt_claim_v2(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.redeem_receipt_claim(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_receipt_claim_v2(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_receipt_claim(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_receipt_claim_v2(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_receipt_claim(text) TO authenticated;
