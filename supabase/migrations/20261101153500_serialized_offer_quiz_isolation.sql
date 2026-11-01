-- Quiz prizes have no condition-offer identity. Reserve only ordinary units
-- so a prize cannot consume stock explicitly assigned to another condition.
DO $$
DECLARE
  v_definition text := pg_catalog.pg_get_functiondef('private.reserve_quiz_product_prize_v2(uuid)'::regprocedure);
  v_old text := $old$      AND vi.status = 'available' AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL$old$;
  v_new text := $new$      AND vi.condition_offer_id IS NULL
      AND vi.status = 'available' AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL$new$;
BEGIN
  IF (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'quiz prize reservation source mismatch';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END;
$$;
