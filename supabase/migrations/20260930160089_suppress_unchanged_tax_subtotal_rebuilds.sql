-- Suppress unchanged tax-subtotal rebuilds. update_order_tax_totals()
-- (20260529072700) rebuilds order_tax_subtotals with DELETE+INSERT on
-- every order_items write — even when the recomputed breakdown is
-- identical (e.g. an item update that changes only fulfillment_data).
-- The manual-document tax trigger (20260930160060) cannot tell those
-- intermediate DELETEs from a real breakdown change, so it clears the
-- invoice dispatch marker and the worker mails a duplicate invoice with
-- an identical attachment after provider acceptance.
--
-- This replacement keeps the orders-row recompute byte-for-byte and
-- gates only the subtotal rewrite on an effective-breakdown compare:
-- when the recomputed groups equal the stored rows, the table is left
-- untouched and no invalidation fires. The end state is identical either
-- way, so all existing flows (including the stale-row cleanup for
-- deregistered merchants) behave exactly as before. Row counts join the
-- compare so a duplicated stored row still rebuilds clean instead of
-- being preserved.
CREATE OR REPLACE FUNCTION public.update_order_tax_totals() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $$
DECLARE
  order_uuid UUID;
  new_tax_exclusive NUMERIC(12, 2);
  new_tax_amount NUMERIC(12, 2);
  merchant_vat_status TEXT;
  order_tax_basis TEXT;
  order_subtotal NUMERIC(12, 2);
  order_shipping_fee NUMERIC(12, 2);
  order_gift_wrapping_fee NUMERIC(12, 2);
  order_discount_amount NUMERIC(12, 2);
  v_breakdown_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    order_uuid := OLD.order_id;
  ELSE
    order_uuid := NEW.order_id;
  END IF;

  -- B3.5 (Δ-50): read tax_basis + total components in the same lookup
  -- as merchant VAT status. We need them BEFORE the UPDATE so we
  -- compute the new total atomically.
  SELECT
    m.vat_registration_status,
    o.tax_basis,
    o.subtotal,
    o.shipping_fee,
    COALESCE(o.gift_wrapping_fee, 0),
    COALESCE(o.discount_amount, 0)
    INTO
      merchant_vat_status,
      order_tax_basis,
      order_subtotal,
      order_shipping_fee,
      order_gift_wrapping_fee,
      order_discount_amount
  FROM orders o
  JOIN merchants m ON o.merchant_id = m.id
  WHERE o.id = order_uuid;

  SELECT
    COALESCE(SUM(line_extension_amount), 0),
    COALESCE(SUM(vat_amount), 0)
    INTO new_tax_exclusive, new_tax_amount
  FROM order_items
  WHERE order_id = order_uuid;

  -- B3.5 (Δ-50): for exclusive orders we MUST recompute total
  -- alongside tax_amount. For inclusive orders total is invariant.
  -- For NULL tax_basis (unclassified backfill rows) we fall back to
  -- pre-B3.5 behavior (breakdown columns only) so this trigger
  -- doesn't change historical totals out from under ops.
  IF order_tax_basis = 'exclusive' THEN
    UPDATE orders
    SET
      tax_exclusive_amount = new_tax_exclusive,
      tax_amount = new_tax_amount,
      tax_inclusive_amount = new_tax_exclusive + new_tax_amount,
      -- Codex P1 (PR #1622): mirror the RPC's
      -- `IF v_total < 0 THEN v_total := 0` clamp. Without
      -- `GREATEST(0, ...)` here, a discount larger than
      -- subtotal+shipping+gift+tax (possible via guest-checkout
      -- payloads or coupon edge cases) writes a NEGATIVE total back
      -- to the row, the RPC's post-trigger re-SELECT then returns
      -- that negative, and the API hands the gateway a nonsense
      -- amount. The clamp keeps the row financially sane even when
      -- inputs are pathological.
      total = GREATEST(
        0,
        order_subtotal
        + order_shipping_fee
        + order_gift_wrapping_fee
        + new_tax_amount
        - order_discount_amount
      ),
      invoice_issue_date = COALESCE(invoice_issue_date, CURRENT_DATE),
      tax_point_date = COALESCE(tax_point_date, CURRENT_DATE)
    WHERE id = order_uuid;
  ELSE
    UPDATE orders
    SET
      tax_exclusive_amount = new_tax_exclusive,
      tax_amount = new_tax_amount,
      tax_inclusive_amount = new_tax_exclusive + new_tax_amount,
      invoice_issue_date = COALESCE(invoice_issue_date, CURRENT_DATE),
      tax_point_date = COALESCE(tax_point_date, CURRENT_DATE)
    WHERE id = order_uuid;
  END IF;

  -- CodeRabbit (PR #1622 round 7): clear stale
  -- `order_tax_subtotals` rows before rebuilding. The prior
  -- upsert-only path left orphan (order_id, vat_category_code,
  -- vat_rate) tuples when (a) an order_item is deleted, (b) an
  -- item's VAT category changes, or (c) the merchant flips from
  -- registered to not-registered. Stale rows poison downstream
  -- tax reporting (the aggregate diverges from the canonical
  -- `order_items` set). The DELETE+INSERT pattern keeps the
  -- aggregate consistent atomically within this trigger
  -- transaction.
  --
  -- Suppression (PR #3580): skip the rewrite when the recomputed
  -- breakdown already matches the stored rows. The DELETE branch of
  -- the manual-document tax trigger cannot distinguish an identical
  -- rebuild from a real change, so an unchanged rebuild would clear
  -- an in-flight invoice marker and duplicate the email. For
  -- deregistered merchants the recomputed set is empty, so stale
  -- stored rows still rebuild (to empty) exactly as before.
  SELECT EXISTS (
    SELECT s.vat_category_code, s.vat_rate, s.taxable_amount, s.tax_amount
    FROM public.order_tax_subtotals AS s
    WHERE s.order_id = order_uuid
    EXCEPT
    SELECT i.vat_category_code, i.vat_rate,
      SUM(i.line_extension_amount), SUM(i.vat_amount)
    FROM public.order_items AS i
    WHERE i.order_id = order_uuid
      AND merchant_vat_status = 'registered'
    GROUP BY i.vat_category_code, i.vat_rate
  ) OR EXISTS (
    SELECT i.vat_category_code, i.vat_rate,
      SUM(i.line_extension_amount), SUM(i.vat_amount)
    FROM public.order_items AS i
    WHERE i.order_id = order_uuid
      AND merchant_vat_status = 'registered'
    GROUP BY i.vat_category_code, i.vat_rate
    EXCEPT
    SELECT s.vat_category_code, s.vat_rate, s.taxable_amount, s.tax_amount
    FROM public.order_tax_subtotals AS s
    WHERE s.order_id = order_uuid
  ) OR (
    (SELECT count(*) FROM public.order_tax_subtotals AS s
     WHERE s.order_id = order_uuid)
    IS DISTINCT FROM
    (SELECT count(*) FROM (
      SELECT i.vat_category_code, i.vat_rate
      FROM public.order_items AS i
      WHERE i.order_id = order_uuid
        AND merchant_vat_status = 'registered'
      GROUP BY i.vat_category_code, i.vat_rate
    ) AS g)
  ) INTO v_breakdown_changed;

  IF v_breakdown_changed THEN
    DELETE FROM order_tax_subtotals
    WHERE order_id = order_uuid;

    IF merchant_vat_status = 'registered' THEN
      INSERT INTO order_tax_subtotals (order_id, vat_category_code, vat_rate, taxable_amount, tax_amount)
      SELECT
        order_uuid,
        vat_category_code,
        vat_rate,
        SUM(line_extension_amount),
        SUM(vat_amount)
      FROM order_items
      WHERE order_id = order_uuid
      GROUP BY vat_category_code, vat_rate;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
