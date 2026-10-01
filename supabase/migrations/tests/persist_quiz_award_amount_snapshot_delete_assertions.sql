-- Focused regression for preserving voucher amounts when the source quiz
-- event is deleted and its order-item foreign keys are cleared.
DO $$
DECLARE
  v_event_id uuid;
  v_ordinary_item_id uuid;
  v_reserved_item_id uuid;
  v_award_id uuid;
  v_amount numeric;
BEGIN
  SELECT event_id, ordinary_item_id, reserved_item_id
  INTO v_event_id, v_ordinary_item_id, v_reserved_item_id
  FROM pg_temp.quiz_award_snapshot_fixture;

  DELETE FROM public.quiz_events
  WHERE id = v_event_id;

  SELECT quiz_award_id, quiz_award_amount
  INTO v_award_id, v_amount
  FROM public.order_items
  WHERE id = v_ordinary_item_id;
  IF v_award_id IS NOT NULL OR v_amount IS DISTINCT FROM 125 THEN
    RAISE EXCEPTION
      'ordinary voucher delete snapshot mismatch: award %, amount %',
      v_award_id,
      v_amount;
  END IF;

  SELECT quiz_award_id, quiz_award_amount
  INTO v_award_id, v_amount
  FROM public.order_items
  WHERE id = v_reserved_item_id;
  IF v_award_id IS NOT NULL OR v_amount IS DISTINCT FROM 525 THEN
    RAISE EXCEPTION
      'serialized prize delete snapshot mismatch: award %, amount %',
      v_award_id,
      v_amount;
  END IF;
END;
$$ LANGUAGE plpgsql;
