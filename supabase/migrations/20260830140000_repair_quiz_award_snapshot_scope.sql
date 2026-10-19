-- Clear award links that do not belong to the order's merchant. The previous
-- scope patch cleared only the copied amount, leaving a foreign id that the
-- transaction-review voucher marker could still treat as a real award.
CREATE OR REPLACE FUNCTION private.sync_order_item_quiz_award_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.quiz_award_id IS NULL THEN
    IF TG_OP = 'UPDATE'
       AND OLD.quiz_award_id IS NOT NULL
       AND OLD.quiz_award_amount IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.quiz_awards AS qa
         WHERE qa.id = OLD.quiz_award_id
       ) THEN
      -- ON DELETE SET NULL invokes this trigger for the child update after the
      -- award row has disappeared. Preserve the historical amount.
      NEW.quiz_award_amount := OLD.quiz_award_amount;
    ELSE
      NEW.quiz_award_amount := NULL;
    END IF;
  ELSE
    -- A client may update every order-item column under its merchant policy;
    -- only copy an award amount when both records belong to that merchant.
    NEW.quiz_award_amount := NULL;
    SELECT qa.amount
    INTO NEW.quiz_award_amount
    FROM public.quiz_awards AS qa
    JOIN public.quiz_events AS event_row
      ON event_row.id = qa.event_id
    JOIN public.orders AS order_row
      ON order_row.id = NEW.order_id
    WHERE qa.id = NEW.quiz_award_id
      AND event_row.merchant_id = order_row.merchant_id;

    IF NOT FOUND THEN
      -- Do not leave a cross-merchant id behind for consumers that use the id
      -- itself as the durable voucher marker.
      NEW.quiz_award_id := NULL;
      NEW.quiz_award_amount := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.sync_order_item_quiz_award_snapshot()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.sync_order_item_quiz_award_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

-- Repair legacy rows regardless of whether the earlier scope migration had
-- already removed their copied amount.
UPDATE public.order_items AS oi
SET quiz_award_id = NULL,
    quiz_award_amount = NULL
WHERE oi.quiz_award_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.quiz_awards AS qa
    JOIN public.quiz_events AS event_row
      ON event_row.id = qa.event_id
    JOIN public.orders AS order_row
      ON order_row.id = oi.order_id
    WHERE qa.id = oi.quiz_award_id
      AND event_row.merchant_id = order_row.merchant_id
  );

UPDATE public.order_items AS oi
SET quiz_award_amount = qa.amount
FROM public.quiz_awards AS qa,
  public.quiz_events AS event_row,
  public.orders AS order_row
WHERE qa.id = oi.quiz_award_id
  AND event_row.id = qa.event_id
  AND order_row.id = oi.order_id
  AND event_row.merchant_id = order_row.merchant_id
  AND oi.quiz_award_amount IS DISTINCT FROM qa.amount;

COMMENT ON FUNCTION private.sync_order_item_quiz_award_snapshot()
  IS 'Captures quiz award amounts only within the order merchant, clears invalid award links, and preserves the snapshot when ON DELETE SET NULL removes the award link.';
