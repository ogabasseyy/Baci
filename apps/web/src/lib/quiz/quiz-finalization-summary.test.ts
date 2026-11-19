import { describe, expect, it } from 'vitest';
import {
  addStepPayload,
  emptySummary,
  hasQuizMutations,
  type MutationTrackingState,
  runtimeGateRejected,
} from './quiz-finalization-summary';

function createState(): MutationTrackingState {
  return {
    hasUnknownMutationResult: false,
    scalarMutationCount: 0,
  };
}

describe('quiz-finalization-summary', () => {
  it('detects runtime gate rejection only for explicit false flags on objects', () => {
    expect(runtimeGateRejected(null)).toBe(false);
    expect(runtimeGateRejected([])).toBe(false);
    expect(
      runtimeGateRejected({ runtimeGateFresh: true, runtimeGateMatches: true })
    ).toBe(false);
    expect(runtimeGateRejected({ runtimeGateFresh: false })).toBe(true);
    expect(runtimeGateRejected({ runtimeGateMatches: false })).toBe(true);
  });

  it('tracks scalar mutation steps and flags malformed scalar payloads', () => {
    const summary = emptySummary();
    const state = createState();

    addStepPayload(
      summary,
      state,
      { name: 'promote_due_scheduled_quiz_events_service_v2' },
      2
    );
    addStepPayload(
      summary,
      state,
      { name: 'close_due_product_quiz_events' },
      1
    );
    addStepPayload(summary, state, { name: 'finalize_due_quiz_events' }, 0);

    expect(summary.scheduledPromoted).toBe(2);
    expect(state.scalarMutationCount).toBe(1);
    expect(state.hasUnknownMutationResult).toBe(false);
    expect(hasQuizMutations(summary, state)).toBe(true);

    const badState = createState();
    addStepPayload(
      emptySummary(),
      badState,
      { name: 'close_due_product_quiz_events' },
      -1
    );
    expect(badState.hasUnknownMutationResult).toBe(true);
  });

  it('allows benign runtime gate booleans while failing closed on empty or unknown-key objects', () => {
    const summary = emptySummary();
    const state = createState();

    addStepPayload(
      summary,
      state,
      {
        name: 'process_due_quiz_deadlines_v2',
        args: { p_production_approved: false, p_production_phase: false },
      },
      {
        scheduledPromoted: 0,
        runtimeGateFresh: true,
        runtimeGateMatches: true,
      }
    );
    expect(state.hasUnknownMutationResult).toBe(false);
    expect(hasQuizMutations(summary, state)).toBe(false);

    const emptyPayloadState = createState();
    addStepPayload(
      emptySummary(),
      emptyPayloadState,
      { name: 'expire_unclaimed_ranked_quiz_awards_v2' },
      {}
    );
    expect(emptyPayloadState.hasUnknownMutationResult).toBe(true);

    const extraKeyState = createState();
    addStepPayload(
      emptySummary(),
      extraKeyState,
      { name: 'expire_unclaimed_ranked_quiz_awards_v2' },
      { expired: 0, unexpectedSignal: 'changed' }
    );
    expect(extraKeyState.hasUnknownMutationResult).toBe(true);
  });

  it('marks runtime gate rejection as failed and aggregates failure counters', () => {
    const summary = emptySummary();
    const state = createState();

    addStepPayload(
      summary,
      state,
      {
        name: 'process_due_quiz_deadlines_v2',
        args: { p_production_approved: true, p_production_phase: true },
      },
      {
        liveAwardRetryPending: 2,
        runtimeGateFresh: false,
        runtimeGateMatches: true,
      }
    );

    expect(summary.failed).toBe(3);
    expect(state.hasUnknownMutationResult).toBe(false);
  });
});
