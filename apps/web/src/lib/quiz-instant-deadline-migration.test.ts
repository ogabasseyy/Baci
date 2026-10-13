import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), '../../supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((file) => /^20\d{12}_.*quiz.*instant.*\.sql$/.test(file))
  .sort();
const sql = migrations
  .map((file) => readFileSync(resolve(migrationsDirectory, file), 'utf8'))
  .join('\n\n');
const lockOrderSql = readFileSync(
  resolve(
    migrationsDirectory,
    '20260830203900_quiz_instant_answer_submission_lock_order_v2.sql'
  ),
  'utf8'
);
const startTimeoutLockOrderSql = readFileSync(
  resolve(
    migrationsDirectory,
    '20260830203950_quiz_instant_start_timeout_lock_order_v2.sql'
  ),
  'utf8'
);
const resumeTimeoutLockOrderSql = readFileSync(
  resolve(
    migrationsDirectory,
    '20260830203960_quiz_instant_resume_timeout_lock_order_v2.sql'
  ),
  'utf8'
);
const retryFairnessSql = readFileSync(
  resolve(
    migrationsDirectory,
    '20260830204400_quiz_instant_deadline_retry_fairness_v2.sql'
  ),
  'utf8'
);
const runtimePublicationInterlockSql = readFileSync(
  resolve(
    migrationsDirectory,
    '20260830204250_quiz_instant_runtime_publication_interlock_v2.sql'
  ),
  'utf8'
);
const runtimeGateSql = readFileSync(
  resolve(
    migrationsDirectory,
    '20260830204500_quiz_instant_runtime_gate_and_stage_isolation_v2.sql'
  ),
  'utf8'
);
const runtimeGateFreshnessSql = readFileSync(
  resolve(
    migrationsDirectory,
    '20260830204600_quiz_instant_runtime_gate_freshness_v2.sql'
  ),
  'utf8'
);
const liveAwardRetrySql = readFileSync(
  resolve(
    migrationsDirectory,
    '20260830204700_quiz_instant_live_award_retry_backoff_v2.sql'
  ),
  'utf8'
);
const liveGateBacklogSql = readFileSync(
  resolve(
    migrationsDirectory,
    '20260830204800_quiz_instant_live_gate_backlog_count_v2.sql'
  ),
  'utf8'
);
const resultWakeupPlayerAccessSql = readFileSync(
  resolve(
    migrationsDirectory,
    '20260831120600_quiz_results_wakeup_player_access_v2.sql'
  ),
  'utf8'
);
describe('instant quiz deadline publication migration', () => {
  it('adds an append-only migration for the instant deadline contract', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('persists every accepted v2 score delta before an attempt is submitted', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION private\.accumulate_quiz_attempt_score_v2\(\)/i
    );
    expect(sql).toMatch(
      /AFTER INSERT ON public\.quiz_attempt_answers[\s\S]*?accumulate_quiz_attempt_score_v2/i
    );
    expect(sql).toMatch(
      /SET score = COALESCE\(attempt\.score, 0\) \+ COALESCE\(NEW\.score_delta, 0\)/i
    );
    expect(sql).toMatch(/event\.contract_version = 2/i);
  });

  it('repairs existing v2 scores before refreshing their indexed standings', () => {
    expect(sql).toMatch(
      /UPDATE public\.quiz_attempts AS attempt[\s\S]*?COALESCE\(pg_catalog\.sum\(answer\.score_delta\)/i
    );
    expect(sql).toMatch(/event\.contract_version = 2/i);
    expect(sql).toMatch(/SET score = corrected\.score/i);
    expect(lockOrderSql).toMatch(
      /LOCK TABLE public\.quiz_attempt_answers IN ROW EXCLUSIVE MODE[\s\S]*?FOR UPDATE OF attempt/i
    );
    expect(sql).toMatch(
      /LOCK TABLE public\.quiz_attempt_answers IN SHARE ROW EXCLUSIVE MODE[\s\S]*?UPDATE public\.quiz_attempts AS attempt[\s\S]*?SET score = corrected\.score/i
    );
  });

  it('orders every timeout answer writer before the one-time score repair', () => {
    expect(startTimeoutLockOrderSql).toMatch(
      /quiz_route_proof_valid[\s\S]*?LOCK TABLE public\.quiz_attempt_answers IN ROW EXCLUSIVE MODE[\s\S]*?SELECT event\.[\s\S]*?FOR UPDATE/i
    );
    expect(resumeTimeoutLockOrderSql).toMatch(
      /quiz_auth_required[\s\S]*?LOCK TABLE public\.quiz_attempt_answers IN ROW EXCLUSIVE MODE[\s\S]*?FOR UPDATE/i
    );
    expect(
      [lockOrderSql, startTimeoutLockOrderSql, resumeTimeoutLockOrderSql].every(
        (source) =>
          source.indexOf(
            'LOCK TABLE public.quiz_attempt_answers IN ROW EXCLUSIVE MODE'
          ) < source.indexOf('FOR UPDATE')
      )
    ).toBe(true);
  });

  it('claims due deadlines inside Postgres and keeps the worker as a fallback', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION private\.process_quiz_deadline_clock_v2\(\)/i
    );
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(sql).toContain("'testZeroPlayerClosed'");
    expect(sql).toContain("'liveZeroPlayerClosed'");
    expect(sql).toContain("'testPublicationFailed'");
    expect(sql).toContain("'liveTerminalizationFailed'");
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*?v_failed/i);
    expect(sql).toMatch(
      /finalization_state IS DISTINCT FROM 'blocked'[\s\S]*?GET DIAGNOSTICS v_failure_marked = ROW_COUNT/i
    );
    expect(sql).toMatch(
      /v_awards := COALESCE\([\s\S]*?finalize_due_live_quiz_events_v2/i
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.process_due_quiz_deadlines_v2\(/i
    );
    expect(sql).not.toMatch(/auth\.role\(\)/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.process_due_quiz_deadlines_v2\(boolean, boolean\)[\s\S]*?FROM PUBLIC, anon, authenticated/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.process_due_quiz_deadlines_v2\(boolean, boolean\)[\s\S]*?TO service_role/i
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.finalize_due_test_quiz_events_v2\(\),[\s\S]*?TO service_role/i
    );
    expect(sql).toMatch(/cron\.schedule\([\s\S]*?'1 second'/i);
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION private\.promote_due_scheduled_quiz_events_clock_v2\(\)/i
    );
    expect(sql).toMatch(/'scheduledPromotionFailed'/i);
    expect(sql).toMatch(/'deadlineClockFailed'/i);
    expect(sql).toMatch(/'liveFinalizationFailed'/i);
    expect(sql).toContain("'quiz-deadline-clock-v2-log-retention'");
    expect(sql).toMatch(
      /DELETE FROM cron\.job_run_details[\s\S]*?interval '2 days'/i
    );
  });

  it('publishes gated live results without re-terminalizing blocked events', () => {
    expect(sql).toMatch(
      /terminalize_due_live_quiz_events_clock_v2\(\)[\s\S]*?attempts_terminalized_at IS NULL/i
    );
    expect(sql).toMatch(
      /finalize_due_live_quiz_events_v2\([\s\S]*?quiz_live_prize_regulatory_ready_v2[\s\S]*?materialize_quiz_event_results_v2/i
    );
    expect(sql).toMatch(
      /ORDER BY \(event\.finalization_state = 'blocked'\), event\.ends_at/i
    );
    expect(retryFairnessSql).toMatch(
      /test_result_publication_failed'\) NULLS FIRST/i
    );
    expect(retryFairnessSql).toMatch(
      /live_attempt_terminalization_failed'\) NULLS FIRST/i
    );
  });

  it('persists a throttled deadline-clock health signal', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.quiz_deadline_clock_health_v2/i
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION private\.run_quiz_deadline_clock_v2\(\)/i
    );
    expect(sql).toMatch(/interval '30 seconds'/i);
    expect(sql).toContain("'SELECT private.run_quiz_deadline_clock_v2()'");
  });

  it('uses the persisted production gate and isolates deadline stages', () => {
    expect(runtimePublicationInterlockSql).toMatch(
      /BEFORE UPDATE OF results_published_at ON public\.quiz_events/i
    );
    expect(runtimePublicationInterlockSql).toMatch(
      /production_phase IS TRUE[\s\S]*?production_approved IS TRUE[\s\S]*?interval '30 seconds'/i
    );
    expect(runtimeGateSql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.quiz_runtime_control_v2/i
    );
    expect(runtimeGateSql).toMatch(
      /FROM public\.quiz_runtime_control_v2 AS control/i
    );
    expect(runtimeGateSql).not.toMatch(
      /process_due_quiz_deadlines_v2\(true, true\)/i
    );
    expect(runtimeGateSql).toContain("'testDeadlineClockFailed'");
    expect(runtimeGateSql).toContain("'liveDeadlineClockFailed'");
    expect(runtimeGateSql).toMatch(
      /BEGIN[\s\S]*?finalize_due_test_quiz_events_clock_v2\(\)[\s\S]*?EXCEPTION WHEN OTHERS[\s\S]*?BEGIN[\s\S]*?terminalize_due_live_quiz_events_clock_v2\(\)[\s\S]*?EXCEPTION WHEN OTHERS/i
    );
  });

  it('expires stale production approval before the database clock awards', () => {
    expect(runtimeGateFreshnessSql).toMatch(
      /control\.updated_at[\s\S]*?v_gate_updated_at/i
    );
    expect(runtimeGateFreshnessSql).toMatch(
      /v_gate_updated_at > v_now - interval '30 seconds'/i
    );
    expect(runtimeGateFreshnessSql).toMatch(
      /IF NOT v_gate_fresh THEN[\s\S]*?v_phase := false;[\s\S]*?v_approved := false;/i
    );
    expect(runtimeGateFreshnessSql).toContain("'runtimeGateFresh'");
  });

  it('backs off persistent live award failures and logs only transitions', () => {
    expect(liveAwardRetrySql).toMatch(
      /finalization_error_code IS DISTINCT FROM[\s\S]*?'live_award_transfer_failed'[\s\S]*?updated_at <=[\s\S]*?interval '30 seconds'/i
    );
    expect(liveAwardRetrySql).toMatch(
      /v_should_log_failure :=[\s\S]*?IS DISTINCT FROM[\s\S]*?'live_award_transfer_failed'/i
    );
    expect(liveAwardRetrySql).toMatch(
      /IF v_should_log_failure THEN[\s\S]*?INSERT INTO public\.leaderboard_refresh_log/i
    );
    expect(liveGateBacklogSql).toMatch(
      /SELECT pg_catalog\.count\(\*\)::integer[\s\S]*?INTO v_blocked[\s\S]*?liveAwaitingGate', v_blocked/i
    );
  });

  it('broadcasts only an empty private wakeup after publication commits', () => {
    expect(sql).toContain("'quiz_results_ready'");
    expect(sql).toContain("'quiz-results:' || p_event_id::text");
    expect(sql).toMatch(/realtime\.send\(\s*'\{\}'::jsonb/i);
    expect(sql).toMatch(
      /AFTER UPDATE OF results_published_at ON public\.quiz_events/i
    );
    expect(sql).toMatch(
      /quiz_attempts[\s\S]*?customer\.user_id = auth\.uid\(\)/i
    );
    expect(sql).toMatch(/public\.has_merchant_access\(event\.merchant_id\)/i);
    expect(sql).toMatch(
      /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/i
    );
    expect(sql).toMatch(
      /pg_catalog\.substring\(realtime\.topic\(\), 14\)::uuid/i
    );
    expect(sql).not.toMatch(
      /pg_catalog\.substring\(realtime\.topic\(\) FROM 14\)/i
    );
    expect(sql).toMatch(/quiz results topics reject client sends/i);
    expect(resultWakeupPlayerAccessSql).toMatch(
      /can_receive_quiz_results_wakeup_v2\(realtime\.topic\(\)\)/i
    );
    expect(resultWakeupPlayerAccessSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.can_receive_quiz_results_wakeup_v2\(text\)[\s\S]*?FROM PUBLIC, anon, service_role/i
    );
    expect(resultWakeupPlayerAccessSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.can_receive_quiz_results_wakeup_v2\(text\)[\s\S]*?TO authenticated/i
    );
  });
});
