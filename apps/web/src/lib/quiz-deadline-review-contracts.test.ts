import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), '../../supabase/migrations');
const ciWorkflow = readFileSync(
  resolve(process.cwd(), '../../.github/workflows/ci.yml'),
  'utf8'
);
const readMigration = (file: string) =>
  readFileSync(resolve(migrationsDirectory, file), 'utf8');

describe('quiz deadline review contracts', () => {
  it('runs every deadline repair SQL proof in chronological replay CI', () => {
    for (const file of [
      'quiz_live_score_publication_gate_v2.sql',
      'quiz_instant_deadline_publication_v2.sql',
      'quiz_instant_deadline_runtime_gate_v2.sql',
      'quiz_instant_live_award_retry_v2.sql',
      'quiz_instant_score_repair_lock_order_v2.sql',
      'quiz_instant_retry_pending_health_v2.sql',
      'quiz_results_wakeup_player_access_v2.sql',
      'quiz_test_publication_control_rls_v2.sql',
      'quiz_cascade_score_consistency_v2.sql',
      'quiz_runtime_gate_stale_health_v2.sql',
      'quiz_score_repair_quiescence_gate_v2.sql',
    ]) {
      expect(ciWorkflow).toContain(
        `--sql-check supabase/migrations/tests/${file}`
      );
    }
  });

  it('subtracts accepted scores before device-integrity question cascades', () => {
    const sql = readMigration(
      '20260831120800_quiz_cascade_score_consistency_v2.sql'
    );
    expect(sql).toMatch(/BEFORE DELETE ON public\.quiz_attempt_questions/i);
    expect(sql).toMatch(
      /sum\(answer\.score_delta\)[\s\S]*?GREATEST\(score - v_score_delta, 0\)/i
    );
  });

  it('marks a stale runtime gate as degraded clock health', () => {
    const sql = readMigration(
      '20260831120900_quiz_runtime_gate_stale_health_v2.sql'
    );
    expect(sql).toMatch(
      /CASE WHEN v_gate_fresh THEN 0 ELSE 1 END[\s\S]*?IF v_failed > 0/i
    );
    expect(sql).toContain("'runtimeGateFresh'");
  });
});
