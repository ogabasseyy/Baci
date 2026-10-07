BEGIN;
CREATE FUNCTION savings_notifications.emit(p_goal uuid, p_key text, p_type text, p_title text, p_body text,
  p_due_period_start timestamptz DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO savings_notifications.events(merchant_id, customer_id, goal_id, event_key, type, title, body, due_period_start)
  SELECT goal.merchant_id, goal.customer_id, goal.id, p_key, p_type, p_title, p_body, p_due_period_start
  FROM public.customer_savings_goals goal JOIN public.customers customer
    ON customer.id = goal.customer_id AND customer.merchant_id = goal.merchant_id
  WHERE goal.id = p_goal AND customer.deleted_at IS NULL
  ON CONFLICT (merchant_id, customer_id, goal_id, event_key) DO NOTHING;
$$;

CREATE FUNCTION savings_notifications.contribution_recorded() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE goal public.customer_savings_goals%ROWTYPE; total numeric; previous numeric; milestone integer; progress integer;
  prior_milestone integer; preference jsonb; period text; consecutive integer; title text; zone text; current_period date;
BEGIN
  IF NEW.status <> 'completed' OR (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN RETURN NEW; END IF;
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id = NEW.goal_id
    AND merchant_id = NEW.merchant_id AND customer_id = NEW.customer_id FOR UPDATE;
  IF NOT FOUND OR goal.status NOT IN ('active','completed') THEN RETURN NEW; END IF;
  SELECT coalesce(sum(amount),0) INTO total FROM public.customer_savings_contributions
    WHERE goal_id = goal.id AND merchant_id = goal.merchant_id AND customer_id = goal.customer_id AND status = 'completed';
  previous := greatest(0, total - NEW.amount);
  progress := least(100, floor(total * 100 / goal.target_amount))::integer;
  title := left(regexp_replace(goal.title, '[[:cntrl:]]', '', 'g'), 72);
  SELECT max(value) INTO milestone FROM unnest(ARRAY[25,50,75,90,100]) value WHERE total * 100 >= goal.target_amount * value;
  SELECT max(value) INTO prior_milestone FROM unnest(ARRAY[25,50,75,90,100]) value WHERE previous * 100 >= goal.target_amount * value;
  IF milestone = 100 AND coalesce(prior_milestone,0) < 100 THEN
    PERFORM savings_notifications.emit(goal.id, 'milestone:100', 'goal_completed', 'You reached your savings goal!',
      'Your savings for ' || title || ' are complete. Open your plan to review your next step.');
  ELSIF milestone IS NOT NULL AND milestone > coalesce(prior_milestone,0) THEN
    PERFORM savings_notifications.emit(goal.id, 'milestone:' || milestone, 'milestone',
      CASE WHEN milestone = 50 THEN 'Halfway there!' ELSE 'Your next upgrade is getting closer' END,
      'You have saved ' || progress || '% towards ' || title || '. Just ' || (100 - progress) || '% left. Keep going!');
  ELSIF previous = 0 THEN
    PERFORM savings_notifications.emit(goal.id, 'first-contribution', 'first_contribution', 'Your first step is done!',
      'Your first contribution to ' || title || ' is confirmed. Every contribution brings you closer.');
  ELSE
    preference := savings_notifications.preference_json(goal.merchant_id, goal.customer_id);
    zone := preference->>'timeZone';
    period := CASE goal.contribution_frequency WHEN 'daily' THEN 'day' WHEN 'weekly' THEN 'week' ELSE 'month' END;
    current_period := date_trunc(period, coalesce(NEW.processed_at, NEW.created_at) AT TIME ZONE zone)::date;
    SELECT count(DISTINCT date_trunc(period, coalesce(processed_at, created_at) AT TIME ZONE zone)) INTO consecutive
      FROM public.customer_savings_contributions WHERE goal_id = goal.id AND merchant_id = goal.merchant_id
      AND customer_id = goal.customer_id AND status = 'completed'
      AND date_trunc(period, coalesce(processed_at, created_at) AT TIME ZONE zone)::date BETWEEN
        (current_period - CASE period WHEN 'day' THEN interval '2 days' WHEN 'week' THEN interval '2 weeks' ELSE interval '2 months' END)::date AND current_period;
    IF consecutive = 3 THEN
      PERFORM savings_notifications.emit(goal.id, 'streak:' || current_period, 'streak', 'Consistency looks good on you',
        'You have contributed in three consecutive saving periods for ' || title || '. Keep building at your own pace.');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_savings_engagement_contribution AFTER INSERT OR UPDATE OF status
  ON public.customer_savings_contributions FOR EACH ROW EXECUTE FUNCTION savings_notifications.contribution_recorded();

CREATE FUNCTION savings_notifications.interest_recorded() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE operation piggyvest_savings_ledger.operations%ROWTYPE;
BEGIN
  IF NEW.account <> 'paid_interest' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT operation FROM piggyvest_savings_ledger.operations WHERE id = NEW.operation_id;
  IF operation.command->>'kind' = 'credit_eligible_paid_interest' AND NEW.amount_kobo > 0 THEN
    PERFORM savings_notifications.emit(operation.goal_id, 'interest:' || operation.id, 'interest_credited',
      'Your savings earned interest', '₦' || to_char(NEW.amount_kobo::numeric / 100, 'FM999,999,999,999,990.00') ||
      ' in confirmed savings interest has been credited to you. View the details in your wallet.');
  ELSIF operation.command->>'kind' = 'reverse_credit' AND NEW.amount_kobo < 0 THEN
    UPDATE savings_notifications.events SET voided_at = now()
      WHERE merchant_id = operation.merchant_id AND customer_id = operation.customer_id
      AND goal_id = operation.goal_id AND event_key = 'interest:' || operation.reference_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_savings_engagement_interest AFTER INSERT ON piggyvest_savings_ledger.postings
  FOR EACH ROW EXECUTE FUNCTION savings_notifications.interest_recorded();

CREATE FUNCTION savings_notifications.generate_due(p_now timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE goal record; preferences jsonb; local_now timestamp; due date; period integer; last_week date;
  week_amount numeric; before_count bigint; after_count bigint; goal_title text; last_due timestamp;
BEGIN
  SELECT count(*) INTO before_count FROM savings_notifications.events;
  FOR goal IN SELECT candidate_goal.id, candidate_goal.merchant_id, candidate_goal.customer_id, candidate_goal.title, candidate_goal.start_date,
    candidate_goal.maturity_date, candidate_goal.contribution_frequency, candidate_goal.preferred_debit_time, candidate_goal.contribution_amount,
    candidate_goal.current_amount, candidate_goal.target_amount FROM public.customer_savings_goals candidate_goal
    JOIN public.customers customer ON customer.id = candidate_goal.customer_id AND customer.merchant_id = candidate_goal.merchant_id
    WHERE candidate_goal.status = 'active' AND customer.user_id IS NOT NULL AND customer.deleted_at IS NULL LOOP
    preferences := savings_notifications.preference_json(goal.merchant_id, goal.customer_id);
    local_now := p_now AT TIME ZONE (preferences->>'timeZone');
    goal_title := left(regexp_replace(goal.title, '[[:cntrl:]]', '', 'g'), 72);
    IF (preferences->>'weeklySummaryEnabled')::boolean AND extract(isodow FROM local_now) = 1 AND local_now::time >= '09:00'::time THEN
      last_week := date_trunc('week', local_now)::date - 7;
      SELECT coalesce(sum(amount),0) INTO week_amount FROM public.customer_savings_contributions
        WHERE goal_id = goal.id AND merchant_id = goal.merchant_id AND customer_id = goal.customer_id AND status = 'completed'
        AND coalesce(processed_at, created_at) >= (last_week::timestamp AT TIME ZONE (preferences->>'timeZone'))
        AND coalesce(processed_at, created_at) < ((last_week + 7)::timestamp AT TIME ZONE (preferences->>'timeZone'));
      PERFORM savings_notifications.emit(goal.id, 'weekly:' || last_week, 'weekly_summary', 'Your weekly savings check-in',
        'You saved ₦' || to_char(week_amount, 'FM999,999,999,990.00') || ' towards ' || goal_title ||
        ' last week. Open your plan to see your progress.');
    END IF;
    IF NOT (preferences->>'encouragementEnabled')::boolean OR local_now::date < goal.start_date OR local_now::date > goal.maturity_date THEN CONTINUE; END IF;
    IF goal.contribution_frequency = 'daily' THEN
      due := local_now::date - 1;
    ELSIF goal.contribution_frequency = 'weekly' THEN
      due := goal.start_date + (((local_now::date - goal.start_date) / 7) * 7);
      IF due + coalesce(goal.preferred_debit_time, '09:00'::time) > local_now - interval '1 day' THEN due := due - 7; END IF;
    ELSE
      period := (extract(year FROM local_now)::integer - extract(year FROM goal.start_date)::integer) * 12 +
        extract(month FROM local_now)::integer - extract(month FROM goal.start_date)::integer;
      due := (goal.start_date + make_interval(months => period))::date;
      IF due + coalesce(goal.preferred_debit_time, '09:00'::time) > local_now - interval '1 day' THEN
        due := (goal.start_date + make_interval(months => period - 1))::date;
      END IF;
    END IF;
    last_due := due + coalesce(goal.preferred_debit_time, '09:00'::time);
    IF due >= goal.start_date AND last_due <= local_now - interval '1 day' AND NOT EXISTS (
      SELECT 1 FROM public.customer_savings_contributions WHERE goal_id = goal.id AND merchant_id = goal.merchant_id
        AND customer_id = goal.customer_id AND status = 'completed'
        AND coalesce(processed_at, created_at) >= (due::timestamp AT TIME ZONE (preferences->>'timeZone'))
    ) THEN
      PERFORM savings_notifications.emit(goal.id, 'missed:' || due, 'missed_contribution', 'Ready when you are',
        'Your planned ₦' || to_char(goal.contribution_amount, 'FM999,999,999,990.00') || ' contribution to ' || goal_title ||
        ' is still open. Continue whenever you are ready.', due::timestamp AT TIME ZONE (preferences->>'timeZone'));
    END IF;
  END LOOP;
  SELECT count(*) INTO after_count FROM savings_notifications.events;
  RETURN (after_count - before_count)::integer;
END $$;
CREATE FUNCTION savings_notifications.enqueue_due() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT savings_notifications.generate_due(now());
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA savings_notifications FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA savings_notifications TO baci_savings_notifications_worker;
GRANT EXECUTE ON FUNCTION savings_notifications.enqueue_due() TO baci_savings_notifications_worker;
COMMIT;
