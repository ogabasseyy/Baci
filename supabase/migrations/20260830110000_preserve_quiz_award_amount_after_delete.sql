-- Keep a captured voucher amount when the source award is removed. The
-- order-item foreign key intentionally clears quiz_award_id on award deletion,
-- but the amount remains the durable historical marker for transaction review.
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
      -- ON DELETE SET NULL invokes this trigger for the child update after
      -- the award row has disappeared. Preserve the previously captured
      -- amount so the voucher discount cannot be redistributed as unknown.
      NEW.quiz_award_amount := OLD.quiz_award_amount;
    ELSE
      NEW.quiz_award_amount := NULL;
    END IF;
  ELSE
    SELECT qa.amount
    INTO NEW.quiz_award_amount
    FROM public.quiz_awards AS qa
    WHERE qa.id = NEW.quiz_award_id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.sync_order_item_quiz_award_snapshot()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.sync_order_item_quiz_award_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.sync_order_item_quiz_award_snapshot()
  IS 'Captures quiz award amounts and preserves the snapshot when ON DELETE SET NULL removes the award link.';
