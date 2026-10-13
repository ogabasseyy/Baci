-- Preserve the server-authoritative quiz voucher amount on each order item.
-- Transaction review runs under merchant RLS and cannot safely read the
-- customer-owned quiz_awards row after the award has been claimed.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS quiz_award_amount numeric(12, 2);

COMMENT ON COLUMN public.order_items.quiz_award_amount IS
  'Server-captured quiz store-credit amount applied to this order item at redemption time.';

CREATE OR REPLACE FUNCTION private.sync_order_item_quiz_award_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.quiz_award_id IS NULL THEN
    NEW.quiz_award_amount := NULL;
  ELSE
    SELECT qa.amount
    INTO NEW.quiz_award_amount
    FROM public.quiz_awards AS qa
    WHERE qa.id = NEW.quiz_award_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_order_item_quiz_award_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS sync_order_item_quiz_award_snapshot
  ON public.order_items;
CREATE TRIGGER sync_order_item_quiz_award_snapshot
  BEFORE INSERT OR UPDATE OF quiz_award_id, quiz_award_amount
  ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_order_item_quiz_award_snapshot();

CREATE OR REPLACE FUNCTION private.sync_reserved_quiz_award_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.reserved_order_item_id IS NOT NULL THEN
    UPDATE public.order_items
    SET
      quiz_award_id = NEW.id,
      quiz_award_amount = NEW.amount
    WHERE public.order_items.id = NEW.reserved_order_item_id
      AND (
        public.order_items.quiz_award_id IS DISTINCT FROM NEW.id
        OR public.order_items.quiz_award_amount IS DISTINCT FROM NEW.amount
      );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_reserved_quiz_award_order_item()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS sync_reserved_quiz_award_order_item
  ON public.quiz_awards;
CREATE TRIGGER sync_reserved_quiz_award_order_item
  AFTER INSERT OR UPDATE OF reserved_order_item_id, amount
  ON public.quiz_awards
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_reserved_quiz_award_order_item();

-- Repair rows created before the snapshot was introduced. The second update
-- also restores voucher identity for serialized prize reservations, whose
-- order item was created before the award row existed.
UPDATE public.order_items AS oi
SET quiz_award_amount = qa.amount
FROM public.quiz_awards AS qa
WHERE qa.id = oi.quiz_award_id
  AND oi.quiz_award_amount IS DISTINCT FROM qa.amount;

UPDATE public.order_items AS oi
SET
  quiz_award_id = qa.id,
  quiz_award_amount = qa.amount
FROM public.quiz_awards AS qa
WHERE qa.reserved_order_item_id = oi.id
  AND oi.quiz_award_id IS NULL;
