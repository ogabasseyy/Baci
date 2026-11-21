-- Lock quiz_question_variants against answer-key or prompt mutation while an
-- edge_rooms event is active or completed, guaranteeing final DB scoring matches
-- the frozen QuizEventConfig answerKeyHash used by Cloudflare Durable Object rooms.
CREATE OR REPLACE FUNCTION private.guard_quiz_edge_variants_immutable_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slot_id uuid := COALESCE(OLD.slot_id, NEW.slot_id);
  v_locked boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.quiz_question_slots AS slot
    INNER JOIN public.quiz_events AS event ON event.id = slot.event_id
    WHERE slot.id = v_slot_id
      AND event.backend_mode = 'edge_rooms'
      AND event.status IN ('active', 'completed')
  )
  INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'quiz_edge_variants_locked_while_active'
      USING ERRCODE = 'QZ063';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_quiz_edge_variants_immutable_v2
  ON public.quiz_question_variants;

CREATE TRIGGER guard_quiz_edge_variants_immutable_v2
  BEFORE UPDATE OR DELETE ON public.quiz_question_variants
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_quiz_edge_variants_immutable_v2();
