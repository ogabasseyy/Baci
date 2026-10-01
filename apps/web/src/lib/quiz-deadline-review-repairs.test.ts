import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), '../../supabase/migrations');
const migrations = readdirSync(migrationsDirectory).sort();
const readMigration = (file: string) =>
  readFileSync(resolve(migrationsDirectory, file), 'utf8');
const liveScorePublicationGateSql = readMigration(
  '20260830193440_quiz_instant_live_publication_score_gate_v2.sql'
);
const liveScorePublicationGateProofSql = readFileSync(
  resolve(migrationsDirectory, 'tests/quiz_live_score_publication_gate_v2.sql'),
  'utf8'
);
const scorePublicationGateSql = readMigration(
  '20260830193441_quiz_instant_test_publication_score_gate_v2.sql'
);
const scorePublicationReadySql = readMigration(
  '20260830204001_quiz_instant_test_publication_score_gate_ready_v2.sql'
);
const scoreRepairQuiescenceSql = readMigration(
  '20260830203999_quiz_instant_score_repair_quiescence_gate_v2.sql'
);
const scoreRepairQuiescenceProofSql = readFileSync(
  resolve(
    migrationsDirectory,
    'tests/quiz_score_repair_quiescence_gate_v2.sql'
  ),
  'utf8'
);
const deadlineControlRepairSql = [
  '20260831120000_quiz_instant_test_publication_retry_backoff_v2.sql',
  '20260831120100_quiz_instant_runtime_gate_commit_and_batch_v2.sql',
  '20260831120200_quiz_instant_live_backlog_index_health_v2.sql',
  '20260831120300_quiz_instant_retry_health_aggregation_v2.sql',
  '20260831121000_quiz_runtime_gate_server_clock_batch_v2.sql',
]
  .map(readMigration)
  .join('\n\n');
const retryPendingHealthSql = [
  '20260831120400_quiz_instant_test_retry_health_v2.sql',
  '20260831120500_quiz_instant_live_terminal_retry_health_v2.sql',
]
  .map(readMigration)
  .join('\n\n');
const wakeupAccessSql = readMigration(
  '20260831120600_quiz_results_wakeup_player_access_v2.sql'
);
const testPublicationControlRlsSql = readMigration(
  '20260831120700_quiz_test_publication_control_rls_v2.sql'
);
const serverClockRuntimeGateSql = readMigration(
  '20260831121000_quiz_runtime_gate_server_clock_batch_v2.sql'
);

describe('quiz deadline review repairs', () => {
  it('blocks live publication before the first score repair can run', () => {
    const earlyGate =
      '20260830193440_quiz_instant_live_publication_score_gate_v2.sql';
    const firstRepair =
      '20260830193442_quiz_instant_deadline_publication_v2.sql';
    expect(liveScorePublicationGateSql).toMatch(
      /BEFORE UPDATE OF results_published_at ON public\.quiz_events/i
    );
    expect(liveScorePublicationGateSql).toMatch(
      /NEW\.mode <> 'live'[\s\S]*?quiz_live_score_publication_not_ready/i
    );
    expect(liveScorePublicationGateSql).toMatch(
      /ALTER TABLE private\.quiz_test_publication_control_v2[\s\S]*?ENABLE ROW LEVEL SECURITY/i
    );
    expect(liveScorePublicationGateSql).not.toMatch(/CREATE POLICY/i);
    expect(liveScorePublicationGateProofSql).toMatch(
      /INSERT INTO public\.quiz_events\([\s\S]*?compliance_verified, regulatory_basis,\s*regulatory_jurisdiction, regulatory_evidence_ref[\s\S]*?VALUES \([\s\S]*?'Africa\/Lagos', true,\s*'free_skill_competition', 'Nigeria', 'automated migration replay evidence'/i
    );
    expect(migrations.indexOf(earlyGate)).toBeLessThan(
      migrations.indexOf(firstRepair)
    );
  });

  it('keeps test publication closed until serialized score repair completes', () => {
    const indexOfMigration = (file: string) => {
      const index = migrations.indexOf(file);
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    };
    expect(scorePublicationGateSql).toMatch(
      /BEFORE UPDATE OF results_published_at ON public\.quiz_events/i
    );
    expect(scorePublicationGateSql).toMatch(
      /NEW\.mode <> 'test'[\s\S]*?quiz_test_score_publication_not_ready/i
    );
    expect(scorePublicationReadySql).toMatch(
      /UPDATE private\.quiz_test_publication_control_v2[\s\S]*?SET score_repair_ready = true/i
    );
    expect(
      indexOfMigration(
        '20260830193441_quiz_instant_test_publication_score_gate_v2.sql'
      )
    ).toBeLessThan(
      indexOfMigration(
        '20260830193442_quiz_instant_deadline_publication_v2.sql'
      )
    );
    expect(
      indexOfMigration(
        '20260830204000_quiz_instant_score_serialization_repair_v2.sql'
      )
    ).toBeLessThan(
      indexOfMigration(
        '20260830204001_quiz_instant_test_publication_score_gate_ready_v2.sql'
      )
    );
  });

  it('refuses serialized score repair while a v2 quiz can accept answers', () => {
    expect(scoreRepairQuiescenceSql).toMatch(
      /status = 'active'[\s\S]*?status = 'scheduled'[\s\S]*?starts_at <= pg_catalog\.clock_timestamp\(\)[\s\S]*?ends_at > pg_catalog\.clock_timestamp\(\)/i
    );
    expect(scoreRepairQuiescenceSql).toContain(
      'quiz_score_repair_requires_quiescent_v2_events'
    );
    expect(scoreRepairQuiescenceProofSql).toMatch(
      /INSERT INTO public\.merchants\([\s\S]*?'79000000-0000-4000-8000-000000000002'[\s\S]*?INSERT INTO public\.quiz_events\([\s\S]*?rules_version, live_window_seconds[\s\S]*?'instant-v2', 120[\s\S]*?SET ends_at = starts_at \+ interval '30 seconds',\s*live_window_seconds = 30/i
    );
    expect(
      migrations.indexOf(
        '20260830203999_quiz_instant_score_repair_quiescence_gate_v2.sql'
      )
    ).toBeLessThan(
      migrations.indexOf(
        '20260830204000_quiz_instant_score_serialization_repair_v2.sql'
      )
    );
  });

  it('backs off poison test-publication retries', () => {
    expect(deadlineControlRepairSql).toMatch(
      /test_result_publication_failed'[\s\S]*?updated_at <=[\s\S]*?interval '30 seconds'/i
    );
    expect(deadlineControlRepairSql).toMatch(
      /v_should_log_failure :=[\s\S]*?UPDATE public\.quiz_events[\s\S]*?updated_at = pg_catalog\.clock_timestamp\(\)[\s\S]*?WHERE id = v_event\.id;/i
    );
  });

  it('pre-creates deadline indexes concurrently before transactional fallbacks', () => {
    for (const [indexMigration, fallbackMigration] of [
      [
        '20260831115957_quiz_test_publication_retry_index_v2.sql',
        '20260831120000_quiz_instant_test_publication_retry_backoff_v2.sql',
      ],
      [
        '20260831115958_quiz_live_unpublished_due_index_v2.sql',
        '20260831120200_quiz_instant_live_backlog_index_health_v2.sql',
      ],
      [
        '20260831115959_quiz_live_terminal_retry_index_v2.sql',
        '20260831120500_quiz_instant_live_terminal_retry_health_v2.sql',
      ],
    ]) {
      const sql = readMigration(indexMigration);
      expect(sql.startsWith('-- disable-transaction\n')).toBe(true);
      expect(sql).toMatch(/DROP INDEX CONCURRENTLY IF EXISTS/i);
      expect(sql).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/i);
      expect(sql.indexOf('DROP INDEX CONCURRENTLY')).toBeLessThan(
        sql.indexOf('CREATE INDEX CONCURRENTLY')
      );
      expect(sql).not.toMatch(/\bBEGIN\b/i);
      expect(migrations.indexOf(indexMigration)).toBeLessThan(
        migrations.indexOf(fallbackMigration)
      );
    }
  });

  it('uses server transaction time instead of a caller-settable batch marker', () => {
    expect(serverClockRuntimeGateSql).toContain(
      'pg_catalog.transaction_timestamp()'
    );
    expect(serverClockRuntimeGateSql).not.toContain(
      'baci.quiz_live_publication_batch_xid'
    );
  });

  it('separates the committed runtime gate from deadline processing', () => {
    expect(deadlineControlRepairSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.set_quiz_runtime_control_v2\(/i
    );
    expect(deadlineControlRepairSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.process_due_quiz_deadlines_v2\([\s\S]*?FROM public\.quiz_runtime_control_v2 AS control/i
    );
    expect(deadlineControlRepairSql).not.toMatch(
      /process_due_quiz_deadlines_v2\([\s\S]*?INSERT INTO public\.quiz_runtime_control_v2/i
    );
  });

  it('keeps an approved in-flight batch valid without persisting its lease', () => {
    expect(deadlineControlRepairSql).toMatch(
      /set_config\([\s\S]*?'baci\.quiz_live_publication_batch_xid'/i
    );
    expect(deadlineControlRepairSql).toMatch(
      /current_setting\([\s\S]*?'baci\.quiz_live_publication_batch_xid'[\s\S]*?pg_current_xact_id/i
    );
  });

  it('indexes the unpublished live backlog and reports retry backoff', () => {
    expect(deadlineControlRepairSql).toMatch(
      /CREATE INDEX IF NOT EXISTS quiz_events_v2_live_unpublished_due_idx/i
    );
    expect(deadlineControlRepairSql).toMatch(
      /finalization_error_code = 'live_award_transfer_failed'[\s\S]*?updated_at >[\s\S]*?interval '30 seconds'/i
    );
    expect(deadlineControlRepairSql).toContain("'liveAwardRetryPending'");
    expect(deadlineControlRepairSql).toMatch(
      /v_failed :=[\s\S]*?liveAwardRetryPending/i
    );
  });

  it('keeps backed-off publication and terminalization failures degraded', () => {
    expect(retryPendingHealthSql).toMatch(
      /'testPublicationRetryPending', v_retry_waiting/i
    );
    expect(retryPendingHealthSql).toMatch(
      /'liveTerminalizationRetryPending', v_retry_waiting/i
    );
    expect(retryPendingHealthSql).toMatch(
      /v_failed :=[\s\S]*?testPublicationRetryPending[\s\S]*?liveTerminalizationRetryPending/i
    );
  });

  it('backs off poison live terminalization retries and preserves fresh-first order', () => {
    expect(retryPendingHealthSql).toMatch(
      /live_attempt_terminalization_failed'[\s\S]*?updated_at <=[\s\S]*?interval '30 seconds'/i
    );
    expect(retryPendingHealthSql).toMatch(
      /ORDER BY[\s\S]*?live_attempt_terminalization_failed'\) NULLS FIRST/i
    );
    expect(retryPendingHealthSql).toMatch(
      /v_should_log_failure :=[\s\S]*?UPDATE public\.quiz_events[\s\S]*?updated_at = pg_catalog\.clock_timestamp\(\)[\s\S]*?WHERE id = v_event\.id;/i
    );
  });

  it('authorizes player wakeups without relying on quiz event RLS', () => {
    expect(wakeupAccessSql).toMatch(
      /FUNCTION public\.can_receive_quiz_results_wakeup_v2\([\s\S]*?SECURITY DEFINER/i
    );
    expect(wakeupAccessSql).toMatch(
      /quiz_attempts AS attempt[\s\S]*?customer\.user_id = v_user_id/i
    );
    expect(wakeupAccessSql).toMatch(
      /CREATE POLICY "authorized players receive quiz results wakeups"[\s\S]*?can_receive_quiz_results_wakeup_v2\(realtime\.topic\(\)\)/i
    );
    expect(wakeupAccessSql).not.toMatch(
      /CREATE POLICY[\s\S]*?SELECT 1[\s\S]*?FROM public\.quiz_events/i
    );
  });

  it('enables deny-by-default RLS on the private test-publication gate', () => {
    expect(testPublicationControlRlsSql).toMatch(
      /ALTER TABLE private\.quiz_test_publication_control_v2[\s\S]*?ENABLE ROW LEVEL SECURITY/i
    );
    expect(testPublicationControlRlsSql).not.toMatch(/CREATE POLICY/i);
  });
});
