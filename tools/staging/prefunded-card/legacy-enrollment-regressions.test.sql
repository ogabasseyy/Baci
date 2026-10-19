BEGIN;
SET LOCAL baci.piggyvest_projection_test='on';
DO $$ BEGIN
  IF (SELECT current_amount FROM public.customer_savings_goals WHERE id='33333333-3333-4333-8333-333333333333')<>100
    OR (SELECT count(*) FROM public.customer_savings_contributions
      WHERE goal_id='33333333-3333-4333-8333-333333333333')<>1
    OR (SELECT id FROM public.customer_savings_contributions
      WHERE goal_id='33333333-3333-4333-8333-333333333333')<>'44444444-4444-4444-8444-444444444444'
    OR (SELECT count(*) FROM piggyvest_savings_ledger.bindings
      WHERE goal_id='33333333-3333-4333-8333-333333333333' AND enabled)<>1
    OR (SELECT count(*) FROM prefunded_card.credit_routes
      WHERE goal_id='33333333-3333-4333-8333-333333333333')<>0
    OR (SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings
      WHERE account='principal')<>10000
    OR (SELECT count(*) FROM prefunded_card.bank_projections
      WHERE contribution_id='44444444-4444-4444-8444-444444444444')<>1
    OR (SELECT count(*) FROM prefunded_card.provider_evidence
      WHERE event_id='legacy-event' AND observation->>'status'='verified' AND NOT conflicted
        AND ingestion_login=session_user)<>1
    OR (SELECT count(*) FROM prefunded_card.evidence_authorities
      WHERE integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
        AND ingestion_login='prefunded_evidence' AND reader_login='prefunded_treasury_operator'
        AND currency='NGN' AND enabled)<>1
    OR has_function_privilege('prefunded_treasury_operator',
      'piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
    OR has_schema_privilege('prefunded_treasury_operator','piggyvest_savings_ledger','USAGE') THEN
    RAISE EXCEPTION 'legacy enrollment did not preserve one public contribution and exact principal';
  END IF;
END $$;
SAVEPOINT fresh_legacy_replay;
SET SESSION AUTHORIZATION prefunded_treasury_operator;
SELECT public.recognize_piggyvest_staging_inflow(
  'fresh-legacy-transaction','fresh-legacy-data','fresh-legacy-event','scratch-event-customer','scratch-private-wallet',
  500,0,'fresh-legacy-reference','fresh-legacy-session','2026-09-26T12:01:00Z') AS fresh_result \gset
RESET SESSION AUTHORIZATION;
SELECT :'fresh_result'='recognized' AS fresh_legacy_inflow_accepted \gset
\if :fresh_legacy_inflow_accepted
\else
  \echo existing legacy bank flow did not continue without a route
  \quit 1
\endif
DO $$ BEGIN
  IF (SELECT count(*) FROM public.customer_savings_contributions
      WHERE goal_id='33333333-3333-4333-8333-333333333333')<>2 THEN
    RAISE EXCEPTION 'fresh legacy inflow failed to create its ordinary contribution';
  END IF;
END $$;
ROLLBACK TO SAVEPOINT fresh_legacy_replay;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.customer_savings_contributions
      WHERE goal_id='33333333-3333-4333-8333-333333333333')<>1
    OR (SELECT current_amount FROM public.customer_savings_goals
      WHERE id='33333333-3333-4333-8333-333333333333')<>100 THEN
    RAISE EXCEPTION 'fresh legacy replay rollback did not restore disposable state';
  END IF;
END $$;
SET SESSION AUTHORIZATION prefunded_treasury_operator;
SELECT public.recognize_piggyvest_staging_inflow(
  'legacy-eventdata-uuid','legacy-data','legacy-event','scratch-event-customer','scratch-private-wallet',
  10000,0,'legacy-reference','legacy-session','2026-09-26T12:00:00Z') AS replay_result \gset
RESET SESSION AUTHORIZATION;
SELECT :'replay_result'='duplicate' AS replay_was_duplicate \gset
\if :replay_was_duplicate
\else
  \echo original legacy bank replay did not resolve as duplicate
  \quit 1
\endif
DO $$ BEGIN
  IF (SELECT count(*) FROM public.customer_savings_contributions
      WHERE goal_id='33333333-3333-4333-8333-333333333333')<>1
    OR (SELECT current_amount FROM public.customer_savings_goals
      WHERE id='33333333-3333-4333-8333-333333333333')<>100
    OR (SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='principal')<>10000 THEN
    RAISE EXCEPTION 'legacy replay duplicated public or canonical principal';
  END IF;
END $$;
COMMIT;
