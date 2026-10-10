BEGIN;

CREATE FUNCTION piggyvest_primary.notify_funded_goal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE totals record; funded numeric; goal_title text;
BEGIN
  IF NEW.goal_kind<>'legacy' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT * INTO totals FROM piggyvest_primary.completion_totals(NEW.id,NEW.merchant_id,NEW.customer_id);
  IF NOT FOUND OR totals.paid_interest_kobo<0 OR NEW.target_amount<=0 THEN RETURN NEW; END IF;
  funded:=NEW.current_amount*100+totals.paid_interest_kobo;
  IF NEW.status='completed' AND OLD.status IN ('active','paused') AND funded>=NEW.target_amount*100 THEN
    goal_title:=left(regexp_replace(NEW.title,'[[:cntrl:]]','','g'),72);
    PERFORM savings_notifications.emit(NEW.id,'milestone:100','goal_completed',
      'You reached your savings goal!',
      'Your confirmed savings and credited interest for '||goal_title||' have reached your target. Open your plan to review your next step.');
  ELSIF OLD.status='completed' AND NEW.status='paused' AND funded<NEW.target_amount*100 THEN
    UPDATE savings_notifications.events SET voided_at=coalesce(voided_at,clock_timestamp())
      WHERE merchant_id=NEW.merchant_id AND customer_id=NEW.customer_id
        AND goal_id=NEW.id AND event_key='milestone:100';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_funded_goal_notification
  AFTER UPDATE OF current_amount,target_amount,status ON public.customer_savings_goals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.notify_funded_goal();
REVOKE ALL ON FUNCTION piggyvest_primary.notify_funded_goal()
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
