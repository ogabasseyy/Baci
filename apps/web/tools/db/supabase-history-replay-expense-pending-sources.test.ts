import { describe, expect, it } from 'vitest';
import { EXPENSE_QUIZ_PAYSTACK_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-expense-pending-sources';

describe('supabase history replay expense pending sources', () => {
  it('includes the private receipt cleanup repair migration', () => {
    expect(EXPENSE_QUIZ_PAYSTACK_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260815220000_repair_capture_private_expense_receipt_cleanup.sql'
    );
  });

  it('includes the legacy receipt storage API cleanup restoration migration', () => {
    expect(EXPENSE_QUIZ_PAYSTACK_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260815230000_restore_legacy_receipt_storage_api_cleanup.sql'
    );
  });

  it('registers the append-only instant quiz publication chain', () => {
    const rows = EXPENSE_QUIZ_PAYSTACK_PENDING_REPLAY_SOURCE_ROWS.split('\n');
    const quizRows = rows.filter((row) => row.includes('quiz_instant_'));

    expect(quizRows.map((row) => row.split(' ')[1])).toEqual([
      '20260830193440_quiz_instant_live_publication_score_gate_v2.sql',
      '20260830193441_quiz_instant_test_publication_score_gate_v2.sql',
      '20260830193442_quiz_instant_deadline_publication_v2.sql',
      '20260830193443_quiz_instant_test_deadline_clock_v2.sql',
      '20260830193444_quiz_instant_live_deadline_clock_v2.sql',
      '20260830193445_quiz_instant_deadline_orchestration_v2.sql',
      '20260830193732_quiz_instant_results_wakeup_v2.sql',
      '20260830203900_quiz_instant_answer_submission_lock_order_v2.sql',
      '20260830203950_quiz_instant_start_timeout_lock_order_v2.sql',
      '20260830203960_quiz_instant_resume_timeout_lock_order_v2.sql',
      '20260830203999_quiz_instant_score_repair_quiescence_gate_v2.sql',
      '20260830204000_quiz_instant_score_serialization_repair_v2.sql',
      '20260830204001_quiz_instant_test_publication_score_gate_ready_v2.sql',
      '20260830204100_quiz_instant_live_terminalization_hardening_v2.sql',
      '20260830204200_quiz_instant_live_publication_hardening_v2.sql',
      '20260830204250_quiz_instant_runtime_publication_interlock_v2.sql',
      '20260830204300_quiz_instant_deadline_orchestration_health_v2.sql',
      '20260830204400_quiz_instant_deadline_retry_fairness_v2.sql',
      '20260830204500_quiz_instant_runtime_gate_and_stage_isolation_v2.sql',
      '20260830204600_quiz_instant_runtime_gate_freshness_v2.sql',
      '20260830204700_quiz_instant_live_award_retry_backoff_v2.sql',
      '20260830204800_quiz_instant_live_gate_backlog_count_v2.sql',
      '20260831120000_quiz_instant_test_publication_retry_backoff_v2.sql',
      '20260831120100_quiz_instant_runtime_gate_commit_and_batch_v2.sql',
      '20260831120200_quiz_instant_live_backlog_index_health_v2.sql',
      '20260831120300_quiz_instant_retry_health_aggregation_v2.sql',
      '20260831120400_quiz_instant_test_retry_health_v2.sql',
      '20260831120500_quiz_instant_live_terminal_retry_health_v2.sql',
    ]);
    const appendedRepairFiles = [
      '20260831120600_quiz_results_wakeup_player_access_v2.sql',
      '20260831120700_quiz_test_publication_control_rls_v2.sql',
      '20260831120800_quiz_cascade_score_consistency_v2.sql',
      '20260831120900_quiz_runtime_gate_stale_health_v2.sql',
      '20260831121000_quiz_runtime_gate_server_clock_batch_v2.sql',
      '20260903100000_quiz_attempt_submission_time_v2.sql',
    ];
    const precreatedIndexFiles = [
      '20260831115957_quiz_test_publication_retry_index_v2.sql',
      '20260831115958_quiz_live_unpublished_due_index_v2.sql',
      '20260831115959_quiz_live_terminal_retry_index_v2.sql',
    ];
    const finalInstantRowIndex = rows.findIndex((row) =>
      row.includes(
        '20260831120500_quiz_instant_live_terminal_retry_health_v2.sql'
      )
    );
    const appendedRepairIndices = appendedRepairFiles.map((file) =>
      rows.findIndex((row) => row.includes(file))
    );
    const precreatedIndexIndices = precreatedIndexFiles.map((file) =>
      rows.findIndex((row) => row.includes(file))
    );

    expect(precreatedIndexIndices.every((index) => index >= 0)).toBe(true);
    expect(precreatedIndexIndices).toEqual(
      [...precreatedIndexIndices].sort((left, right) => left - right)
    );
    expect(precreatedIndexIndices.at(-1)).toBeLessThan(finalInstantRowIndex);

    expect([finalInstantRowIndex, ...appendedRepairIndices]).toEqual(
      [...[finalInstantRowIndex, ...appendedRepairIndices]].sort(
        (left, right) => left - right
      )
    );
    expect(
      appendedRepairIndices.every((index) => index > finalInstantRowIndex)
    ).toBe(true);
  });
});
